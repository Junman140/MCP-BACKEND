package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/models"
	"mcp-cbt-backend/internal/packaging"
	"mcp-cbt-backend/internal/telemetry"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type ExamHandler struct {
	Collection *mongo.Collection
}

func NewExamHandler() *ExamHandler {
	return &ExamHandler{
		Collection: db.DB.Collection("exams"),
	}
}

// DownloadExam handles the GET /api/v1/exams/:id/download request
func (h *ExamHandler) DownloadExam(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	idStr := c.Param("id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var exam models.Exam
	err := h.Collection.FindOne(ctx, bson.M{"_id": idStr, "tenantId": tenantID}).Decode(&exam)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found"})
		return
	}

	encryptionKey := []byte(os.Getenv("ENCRYPTION_KEY"))
	if len(encryptionKey) != 32 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ENCRYPTION_KEY must be exactly 32 bytes"})
		return
	}
	mediaDir := "./uploads/media" 

	payload, err := packaging.PackageExam(exam, mediaDir, encryptionKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to package exam"})
		return
	}

	c.Header("Content-Disposition", "attachment; filename=exam.mcp")
	c.Data(http.StatusOK, "application/octet-stream", payload)
}

// SubmitExam handles the POST /api/v1/exams/:id/submit request (mobile).
// Backward compatible:
// - legacy: {question_id, selected_option_id, timestamp, student_id?}
// - new:    {student_id, attempt?, status?, answers:[...], file_uploads:[...]}
func (h *ExamHandler) SubmitExam(c *gin.Context) {
	idStr := c.Param("id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Lookup exam to derive tenantId (mobile submit route is not JWT-protected).
	var exam models.Exam
	if err := h.Collection.FindOne(ctx, bson.M{"_id": idStr}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found"})
		return
	}

	// Parse into a generic map first to support both legacy and new shapes.
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	subColl := db.DB.Collection("submissions_v2")

	studentID, _ := body["student_id"].(string)
	if studentID == "" {
		studentID = "unknown"
	}

	now := time.Now()

	// Enforce attempt limits.
	if exam.Rules.MaxAttempts > 0 {
		attemptCount, _ := subColl.CountDocuments(ctx, bson.M{
			"tenantId":      exam.TenantID,
			"assessment_id": idStr,
			"student_id":    studentID,
		})
		if attemptCount >= int64(exam.Rules.MaxAttempts) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":  "max_attempts_reached",
				"detail": fmt.Sprintf("You have reached the maximum of %d attempt(s) for this assessment.", exam.Rules.MaxAttempts),
			})
			return
		}
	}

	// Enforce exam duration.
	if exam.Metadata.DurationMinutes > 0 {
		var existing models.Submission
		findErr := subColl.FindOne(ctx, bson.M{
			"tenantId":      exam.TenantID,
			"assessment_id": idStr,
			"student_id":    studentID,
			"status":        models.SubmissionStatusInProgress,
		}).Decode(&existing)

		if findErr == nil {
			deadline := existing.StartedAt.Add(time.Duration(exam.Metadata.DurationMinutes) * time.Minute)
			if now.After(deadline) {
				subColl.UpdateOne(ctx,
					bson.M{"_id": existing.ID},
					bson.M{"$set": bson.M{"status": models.SubmissionStatusSubmitted, "submitted_at": now, "updated_at": now}},
				)
				c.JSON(http.StatusForbidden, gin.H{
					"error":          "time_expired",
					"detail":         fmt.Sprintf("Your %d-minute time limit has expired. Submission auto-finalised.", exam.Metadata.DurationMinutes),
					"auto_submitted": true,
				})
				return
			}
		}
	}

	// New format if "answers" is present.
	if _, ok := body["answers"]; ok {
		raw, _ := json.Marshal(body)
		var sub models.Submission
		if err := json.Unmarshal(raw, &sub); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid submission payload"})
			return
		}
		if sub.ID == "" {
			sub.ID = uuid.New().String()
		}
		sub.TenantID = exam.TenantID
		sub.AssessmentID = idStr
		sub.StudentID = studentID
		if sub.Attempt <= 0 {
			sub.Attempt = 1
		}
		if sub.Status == "" {
			sub.Status = models.SubmissionStatusInProgress
		}
		if sub.StartedAt.IsZero() {
			sub.StartedAt = now
		}
		if sub.CreatedAt.IsZero() {
			sub.CreatedAt = now
		}
		sub.UpdatedAt = now

		_, err := subColl.InsertOne(ctx, sub)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save submission"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Submission recorded", "id": sub.ID})
		return
	}

	// Legacy single-answer format.
	var legacy struct {
		StudentID        string `json:"student_id"`
		QuestionID       string `json:"question_id"`
		SelectedOptionID string `json:"selected_option_id"`
		EssayText        string `json:"essay_text"`
		Timestamp        string `json:"timestamp"`
	}
	raw, _ := json.Marshal(body)
	if err := json.Unmarshal(raw, &legacy); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid legacy submission payload"})
		return
	}
	if legacy.StudentID == "" {
		legacy.StudentID = studentID
	}
	ts := now
	if legacy.Timestamp != "" {
		if t, err := time.Parse(time.RFC3339, legacy.Timestamp); err == nil {
			ts = t
		}
	}

	// Upsert into a single in-progress attempt per student per assessment.
	filter := bson.M{
		"tenantId":       exam.TenantID,
		"assessment_id":  idStr,
		"student_id":     legacy.StudentID,
		"attempt":        1,
		"status":         models.SubmissionStatusInProgress,
	}
	update := bson.M{
		"$setOnInsert": bson.M{
			"_id":          uuid.New().String(),
			"tenantId":     exam.TenantID,
			"assessment_id": idStr,
			"student_id":   legacy.StudentID,
			"attempt":      1,
			"status":       models.SubmissionStatusInProgress,
			"started_at":   now,
			"created_at":   now,
		},
		"$set": bson.M{
			"updated_at": now,
		},
		"$push": bson.M{
			"answers": bson.M{
				"question_id":        legacy.QuestionID,
				"selected_option_id": legacy.SelectedOptionID,
				"essay_text":         legacy.EssayText,
				"timestamp":          ts,
			},
		},
	}

	_, err := subColl.UpdateOne(ctx, filter, update, options.UpdateOne().SetUpsert(true))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save submission"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Answer recorded"})
}

// CreateExam handles the POST /api/v1/exams request
func (h *ExamHandler) CreateExam(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	var exam models.Exam
	if err := c.ShouldBindJSON(&exam); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if exam.ID == "" {
		exam.ID = uuid.New().String()
	}
	exam.TenantID = tenantID
	exam.CreatedAt = time.Now()
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := h.Collection.InsertOne(ctx, exam)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create exam"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"id":     result.InsertedID,
	})
}

// ListExams handles the GET /api/v1/exams request.
// Supports optional query filters: course_id, faculty_id, department_id, level, type.
func (h *ExamHandler) ListExams(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := bson.M{"tenantId": tenantID}
	if v := c.Query("course_id"); v != "" {
		filter["course_id"] = v
	}
	if v := c.Query("faculty_id"); v != "" {
		filter["faculty_id"] = v
	}
	if v := c.Query("department_id"); v != "" {
		filter["department_id"] = v
	}
	if v := c.Query("level"); v != "" {
		filter["level"] = v
	}
	if v := c.Query("type"); v != "" {
		filter["type"] = v
	}
	if v := c.Query("semester"); v != "" {
		filter["semester"] = v
	}

	cursor, err := h.Collection.Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch exams"})
		return
	}
	defer cursor.Close(ctx)

	var exams []models.Exam
	if err := cursor.All(ctx, &exams); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode exams"})
		return
	}

	c.JSON(http.StatusOK, exams)
}

// ListSubmissions handles the GET /api/v1/submissions request (admin).
func (h *ExamHandler) ListSubmissions(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	assessmentID := c.Query("assessment_id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := bson.M{"tenantId": tenantID}
	if assessmentID != "" {
		filter["assessment_id"] = assessmentID
	}

	cursor, err := db.DB.Collection("submissions_v2").Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch submissions"})
		return
	}
	defer cursor.Close(ctx)

	var subs []models.Submission
	if err := cursor.All(ctx, &subs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode submissions"})
		return
	}
	c.JSON(http.StatusOK, subs)
}

// GradeSubmission handles PATCH /api/v1/submissions/:id/grade (admin).
// Auto-scores MCQ questions and lets the admin override / add essay scores.
func (h *ExamHandler) GradeSubmission(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	userID := c.GetString("userId")
	idStr := c.Param("id")

	var req struct {
		TotalScore  int64            `json:"total_score"`
		Feedback    string           `json:"feedback"`
		PerQuestion map[string]int64 `json:"per_question"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	subColl := db.DB.Collection("submissions_v2")

	var sub models.Submission
	if err := subColl.FindOne(ctx, bson.M{"_id": idStr, "tenantId": tenantID}).Decode(&sub); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Submission not found"})
		return
	}

	var exam models.Exam
	if err := h.Collection.FindOne(ctx, bson.M{"_id": sub.AssessmentID}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found for this submission"})
		return
	}

	// Build a lookup of correct answers and points by question ID.
	type questionKey struct {
		CorrectOptID string
		Points       int64
	}
	qLookup := make(map[string]questionKey)
	for _, q := range exam.Questions {
		qLookup[q.ID] = questionKey{CorrectOptID: q.CorrectID, Points: q.Points}
	}

	// Auto-score MCQs.
	autoPerQuestion := make(map[string]int64)
	var autoTotal int64
	for _, ans := range sub.Answers {
		qk, ok := qLookup[ans.QuestionID]
		if !ok {
			continue
		}
		if qk.CorrectOptID != "" && ans.SelectedOptionID == qk.CorrectOptID {
			autoPerQuestion[ans.QuestionID] = qk.Points
			autoTotal += qk.Points
		}
	}

	// Merge manual per-question scores (admin overrides / essay scores).
	mergedPerQ := make(map[string]int64)
	for k, v := range autoPerQuestion {
		mergedPerQ[k] = v
	}
	for k, v := range req.PerQuestion {
		mergedPerQ[k] = v
	}

	finalTotal := autoTotal
	if req.TotalScore > 0 {
		finalTotal = req.TotalScore + autoTotal
	}

	now := time.Now()
	grade := models.SubmissionGrade{
		TotalScore:  finalTotal,
		Feedback:    req.Feedback,
		ByUserID:    userID,
		At:          now,
		PerQuestion: mergedPerQ,
	}

	filter := bson.M{"_id": idStr, "tenantId": tenantID}
	update := bson.M{
		"$set": bson.M{
			"grade":      grade,
			"status":     models.SubmissionStatusGraded,
			"updated_at": now,
		},
	}

	res, err := subColl.UpdateOne(ctx, filter, update)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save grade"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Submission not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "grade": grade})
}

// UploadAssignmentFile handles POST /api/v1/exams/:id/upload (mobile).
// Stores the file locally and returns a storage key.
func (h *ExamHandler) UploadAssignmentFile(c *gin.Context) {
	idStr := c.Param("id")
	questionID := c.PostForm("question_id")
	studentID := c.PostForm("student_id")
	if studentID == "" {
		studentID = "unknown"
	}
	if questionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question_id is required"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var exam models.Exam
	if err := h.Collection.FindOne(ctx, bson.M{"_id": idStr}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	storageKey := fmt.Sprintf("%s/%s/%s/%s", exam.TenantID, idStr, studentID, uuid.New().String())
	baseDir := "./uploads/assignments"
	targetPath := filepath.Join(baseDir, storageKey)
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create storage directory"})
		return
	}

	if err := c.SaveUploadedFile(file, targetPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	// Append reference onto the student's in-progress submission document (attempt 1).
	now := time.Now()
	filter := bson.M{
		"tenantId":       exam.TenantID,
		"assessment_id":  idStr,
		"student_id":     studentID,
		"attempt":        1,
		"status":         models.SubmissionStatusInProgress,
	}
	update := bson.M{
		"$setOnInsert": bson.M{
			"_id":           uuid.New().String(),
			"tenantId":      exam.TenantID,
			"assessment_id": idStr,
			"student_id":    studentID,
			"attempt":       1,
			"status":        models.SubmissionStatusInProgress,
			"started_at":    now,
			"created_at":    now,
		},
		"$set": bson.M{"updated_at": now},
		"$push": bson.M{
			"file_uploads": bson.M{
				"question_id": questionID,
				"file_name":   file.Filename,
				"mime_type":   file.Header.Get("Content-Type"),
				"size_bytes":  file.Size,
				"storage_key": storageKey,
			},
		},
	}
	_, _ = db.DB.Collection("submissions_v2").UpdateOne(ctx, filter, update, options.UpdateOne().SetUpsert(true))

	c.JSON(http.StatusOK, gin.H{"status": "success", "storage_key": storageKey})
}

// GetStats handles the GET /api/v1/stats request for the Admin Dashboard
func (h *ExamHandler) GetStats(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	authHeader := c.GetHeader("Authorization")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	examsCount, _ := h.Collection.CountDocuments(ctx, bson.M{"tenantId": tenantID})
	subsCount, _ := db.DB.Collection("submissions_v2").CountDocuments(ctx, bson.M{"tenantId": tenantID})

	// Fetch statistics from Biometric Backend
	bioURL := os.Getenv("BIOMETRIC_API_URL")
	if bioURL == "" {
		bioURL = "http://127.0.0.1:4000"
	}

	reqURL := fmt.Sprintf("%s/reports/cbt-stats?tenantId=%s", bioURL, tenantID)
	req, _ := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	
	var bioStats struct {
		TotalStudents int64 `json:"total_students"`
		TotalEnrolled int64 `json:"total_enrolled"`
		TotalVerified int64 `json:"total_verified"`
	}

	if err == nil && resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("[GetStats] Bio API response: %s\n", string(body))
		json.Unmarshal(body, &bioStats)
		resp.Body.Close()
	} else if err != nil {
		fmt.Printf("[GetStats] Error fetching bio stats: %v\n", err)
	} else if resp != nil {
		fmt.Printf("[GetStats] Bio API returned status: %d\n", resp.StatusCode)
		resp.Body.Close()
	}

	c.JSON(http.StatusOK, gin.H{
		"total_students":    bioStats.TotalStudents,
		"registered_exams":  examsCount,
		"passed_biometrics": bioStats.TotalVerified,
		"exams_submitted":   subsCount,
	})
}

// ListResults handles the GET /api/v1/results request
func (h *ExamHandler) ListResults(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cursor, err := db.DB.Collection("submissions_v2").Find(ctx, bson.M{"tenantId": tenantID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch results"})
		return
	}
	defer cursor.Close(ctx)

	var results []bson.M
	if err := cursor.All(ctx, &results); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode results"})
		return
	}

	c.JSON(http.StatusOK, results)
}

func ptrBool(v bool) *bool { return &v }

// PostTelemetry handles the POST /api/v1/telemetry request
func (h *ExamHandler) PostTelemetry(c *gin.Context) {
	var tel struct {
		StudentID string `json:"student_id"`
		ExamID    string `json:"exam_id"`
		Status    string `json:"status"`
		Focus     bool   `json:"focus"`
		Violation string `json:"violation,omitempty"`
	}

	if err := c.ShouldBindJSON(&tel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	now := time.Now()

	coll := db.DB.Collection("telemetry")
	_, err := coll.InsertOne(ctx, bson.M{
		"student_id": tel.StudentID,
		"exam_id":    tel.ExamID,
		"status":     tel.Status,
		"focus":      tel.Focus,
		"violation":  tel.Violation,
		"timestamp":  now,
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to log telemetry"})
		return
	}

	// Broadcast to live proctoring dashboard
	telemetry.DefaultHub.Broadcast(telemetry.TelemetryEvent{
		StudentID: tel.StudentID,
		ExamID:    tel.ExamID,
		Status:    tel.Status,
		Focus:     tel.Focus,
		Violation: tel.Violation,
		Timestamp: now,
	})

	c.JSON(http.StatusOK, gin.H{"status": "logged"})
}

// UploadMedia handles POST /api/v1/media/upload (admin).
// Accepts multipart file uploads and stores them for use in question media.
func (h *ExamHandler) UploadMedia(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	storageName := fmt.Sprintf("%s_%s_%s", tenantID, uuid.New().String(), file.Filename)
	mediaDir := "./uploads/media"
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create media directory"})
		return
	}

	targetPath := filepath.Join(mediaDir, storageName)
	if err := c.SaveUploadedFile(file, targetPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "uploaded",
		"storage_key": storageName,
		"url":         fmt.Sprintf("/api/v1/media/%s", storageName),
	})
}

// ServeMedia handles GET /api/v1/media/:filename (public).
func (h *ExamHandler) ServeMedia(c *gin.Context) {
	filename := c.Param("filename")
	filePath := filepath.Join("./uploads/media", filename)
	c.File(filePath)
}
