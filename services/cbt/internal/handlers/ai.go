package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"mcp-cbt-backend/internal/ai"
	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type AIHandler struct {
	QuestionsColl    *mongo.Collection
	CurriculaColl    *mongo.Collection
	ExamsColl        *mongo.Collection
	SubmissionsColl  *mongo.Collection
	ModelAnswersColl *mongo.Collection
}

func NewAIHandler() *AIHandler {
	return &AIHandler{
		QuestionsColl:    db.DB.Collection("cbt_questions"),
		CurriculaColl:    db.DB.Collection("cbt_curricula"),
		ExamsColl:        db.DB.Collection("cbt_exams"),
		SubmissionsColl:  db.DB.Collection("cbt_submissions"),
		ModelAnswersColl: db.DB.Collection("cbt_model_answers"),
	}
}

// Health handles GET /api/v1/ai/health.
func (h *AIHandler) Health(c *gin.Context) {
	client := ai.NewClient()
	ok := client.HealthCheck()
	status := "available"
	if !ok {
		status = "unavailable"
	}
	c.JSON(http.StatusOK, gin.H{
		"status": status,
		"model":  ai.OllamaModel,
		"url":    ai.OllamaURL,
	})
}

// Generate handles POST /api/v1/ai/generate.
func (h *AIHandler) Generate(c *gin.Context) {
	var req ai.QuestionGenParams
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Count <= 0 {
		req.Count = 5
	}
	if req.Count > 20 {
		req.Count = 20
	}

	client := ai.NewClient()
	prompt := ai.BuildQuestionGenPrompt(req)

	start := time.Now()
	resp, err := client.Generate(prompt, true)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI generation failed", "detail": err.Error()})
		return
	}

	// Parse the JSON response into our GeneratedQuestion struct.
	var parsed struct {
		Questions []ai.GeneratedQuestion `json:"questions"`
	}
	cleaned := cleanJSON(resp.Response)
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"questions":   []ai.GeneratedQuestion{},
			"raw_output":  resp.Response,
			"elapsed_ms":  elapsed,
			"model_used":  ai.OllamaModel,
			"parse_error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"questions":  parsed.Questions,
		"raw_output": resp.Response,
		"elapsed_ms": elapsed,
		"model_used": ai.OllamaModel,
	})
}

// GenerateFromText handles POST /api/v1/ai/generate-from-text.
func (h *AIHandler) GenerateFromText(c *gin.Context) {
	var req ai.GenerateFromTextParams
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Count <= 0 {
		req.Count = 5
	}
	if req.Count > 20 {
		req.Count = 20
	}
	if len(req.Text) > 50000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Text too long. Maximum 50,000 characters."})
		return
	}

	client := ai.NewClient()
	prompt := ai.BuildFromTextPrompt(req)

	start := time.Now()
	resp, err := client.Generate(prompt, true)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI generation failed", "detail": err.Error()})
		return
	}

	var parsed struct {
		Questions []ai.GeneratedQuestion `json:"questions"`
	}
	cleaned := cleanJSON(resp.Response)
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"questions":   []ai.GeneratedQuestion{},
			"raw_output":  resp.Response,
			"elapsed_ms":  elapsed,
			"model_used":  ai.OllamaModel,
			"parse_error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"questions":  parsed.Questions,
		"raw_output": resp.Response,
		"elapsed_ms": elapsed,
		"model_used": ai.OllamaModel,
		"parse_error": func() string {
			if len(parsed.Questions) == 0 {
				return "Model did not return a 'questions' array. Try smaller count or simpler topic."
			}
			return ""
		}(),
	})
}

// SaveGenerated handles POST /api/v1/ai/save.
func (h *AIHandler) SaveGenerated(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	var req struct {
		Questions    []ai.GeneratedQuestion `json:"questions" binding:"required"`
		CourseID     string                 `json:"course_id"`
		FacultyID    string                 `json:"faculty_id,omitempty"`
		DepartmentID string                 `json:"department_id,omitempty"`
		Level        string                 `json:"level,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.Questions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No questions provided"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	now := time.Now()
	var docs []interface{}
	savedIDs := make([]string, 0, len(req.Questions))

	for _, q := range req.Questions {
		id := uuid.New().String()
		doc := models.BankQuestion{
			ID:           id,
			TenantID:     tenantID,
			Type:         q.Type,
			Content:      q.Content,
			Options:      convertOptions(q.Options),
			CorrectID:    q.CorrectID,
			Points:       q.Points,
			WordLimit:    q.WordLimit,
			Difficulty:   q.Difficulty,
			Tags:         q.Tags,
			Topic:        q.Topic,
			CourseID:     req.CourseID,
			FacultyID:    req.FacultyID,
			DepartmentID: req.DepartmentID,
			Level:        req.Level,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		// Normalize type
		if doc.Type == "" {
			doc.Type = "mcq"
		}
		if doc.Points <= 0 {
			doc.Points = 2
		}
		docs = append(docs, doc)
		savedIDs = append(savedIDs, id)
	}

	if _, err := h.QuestionsColl.InsertMany(ctx, docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save questions", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status":    "saved",
		"count":     len(savedIDs),
		"ids":       savedIDs,
	})
}

// UploadCurriculum handles POST /api/v1/ai/curriculum.
func (h *AIHandler) UploadCurriculum(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	var req struct {
		CourseID   string `json:"course_id"`
		Title      string `json:"title" binding:"required"`
		Content    string `json:"content" binding:"required"`
		SourceType string `json:"source_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.Content) > 100000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content too long. Maximum 100,000 characters."})
		return
	}
	if req.SourceType == "" {
		req.SourceType = "curriculum"
	}

	now := time.Now()
	doc := ai.CurriculumUpload{
		ID:         uuid.New().String(),
		TenantID:   tenantID,
		CourseID:   req.CourseID,
		Title:      req.Title,
		Content:    req.Content,
		SourceType: req.SourceType,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := h.CurriculaColl.InsertOne(ctx, doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save curriculum", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "saved", "id": doc.ID})
}

// ListCurricula handles GET /api/v1/ai/curriculum.
func (h *AIHandler) ListCurricula(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := bson.M{"tenantId": tenantID}
	if courseID := c.Query("course_id"); courseID != "" {
		filter["course_id"] = courseID
	}

	cursor, err := h.CurriculaColl.Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch curricula"})
		return
	}
	defer cursor.Close(ctx)

	var docs []ai.CurriculumUpload
	if err := cursor.All(ctx, &docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode curricula"})
		return
	}

	c.JSON(http.StatusOK, docs)
}

// GradeEssay handles POST /api/v1/ai/grade-essay.
func (h *AIHandler) GradeEssay(c *gin.Context) {
	var req ai.GradeEssayParams
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.QuestionText == "" || req.StudentAnswer == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question_text and student_answer are required"})
		return
	}
	if req.MaxPoints <= 0 {
		req.MaxPoints = 10
	}

	client := ai.NewClient()
	prompt := ai.BuildGradeEssayPrompt(req)

	start := time.Now()
	resp, err := client.Generate(prompt, true)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI grading failed", "detail": err.Error()})
		return
	}

	var result ai.GradeResult
	cleaned := cleanJSON(resp.Response)
	if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"result":     ai.GradeResult{Score: 0, MaxPoints: req.MaxPoints, Feedback: "AI could not parse a valid grade. Raw output attached.", Confidence: 0},
			"raw_output": resp.Response,
			"elapsed_ms": elapsed,
			"parse_error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result":     result,
		"raw_output": resp.Response,
		"elapsed_ms": elapsed,
	})
}

// GradeSubmission handles POST /api/v1/ai/grade-submission/:id.
func (h *AIHandler) GradeSubmission(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	userID := c.GetString("userId")
	subID := c.Param("id")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var sub models.Submission
	if err := h.SubmissionsColl.FindOne(ctx, bson.M{"_id": subID, "tenantId": tenantID}).Decode(&sub); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Submission not found"})
		return
	}

	var exam models.Exam
	if err := h.ExamsColl.FindOne(ctx, bson.M{"_id": sub.AssessmentID}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found for this submission"})
		return
	}

	type qKey struct {
		Content   string
		Points    int64
		WordLimit int
		CorrectID string
	}
	qLookup := make(map[string]qKey)
	for _, q := range exam.Questions {
		qLookup[q.ID] = qKey{Content: q.Content, Points: q.Points, WordLimit: q.WordLimit, CorrectID: q.CorrectID}
	}

	// Auto-score MCQs first.
	autoPerQ := make(map[string]int64)
	var autoTotal int64
	for _, ans := range sub.Answers {
		qk, ok := qLookup[ans.QuestionID]
		if !ok {
			continue
		}
		if qk.CorrectID != "" && ans.SelectedOptionID == qk.CorrectID {
			autoPerQ[ans.QuestionID] = qk.Points
			autoTotal += qk.Points
		}
	}

	// AI-grade essay answers.
	client := ai.NewClient()
	perFeedback := make(map[string]string)
	confidences := make(map[string]float64)
	var maxScore int64
	start := time.Now()

	for _, ans := range sub.Answers {
		qk, ok := qLookup[ans.QuestionID]
		if !ok || qk.CorrectID != "" {
			continue
		}
		if ans.EssayText == "" {
			continue
		}

		params := ai.GradeEssayParams{
			QuestionText:  qk.Content,
			StudentAnswer: ans.EssayText,
			MaxPoints:     qk.Points,
			WordLimit:     qk.WordLimit,
		}

		prompt := ai.BuildGradeEssayPrompt(params)
		resp, err := client.Generate(prompt, true)
		if err != nil {
			perFeedback[ans.QuestionID] = "AI grading failed: " + err.Error()
			continue
		}

		var gr ai.GradeResult
		cleaned := cleanJSON(resp.Response)
		if err := json.Unmarshal([]byte(cleaned), &gr); err != nil {
			perFeedback[ans.QuestionID] = "Could not parse AI response"
			continue
		}

		autoPerQ[ans.QuestionID] = gr.Score
		autoTotal += gr.Score
		maxScore += qk.Points
		perFeedback[ans.QuestionID] = gr.Feedback
		confidences[ans.QuestionID] = gr.Confidence
	}
	maxScore += autoTotal

	elapsed := time.Since(start).Milliseconds()

	// Save the AI grade.
	now := time.Now()
	grade := models.SubmissionGrade{
		TotalScore:  autoTotal,
		Feedback:    fmt.Sprintf("AI-graded. Confidence varies per question. Review recommended."),
		ByUserID:    userID,
		At:          now,
		PerQuestion: autoPerQ,
	}

	update := bson.M{
		"$set": bson.M{
			"grade":            grade,
			"status":           models.SubmissionStatusGraded,
			"updated_at":       now,
			"ai_per_feedback":  perFeedback,
			"ai_confidences":   confidences,
		},
	}

	h.SubmissionsColl.UpdateOne(ctx, bson.M{"_id": subID, "tenantId": tenantID}, update)

	c.JSON(http.StatusOK, ai.SubmissionGradeResult{
		SubmissionID: subID,
		PerQuestion:  autoPerQ,
		PerFeedback:  perFeedback,
		Confidences:  confidences,
		TotalScore:   autoTotal,
		MaxScore:     maxScore,
		ElapsedMs:    elapsed,
	})
}

// ComputeSimilarity handles POST /api/v1/ai/similarity.
func (h *AIHandler) ComputeSimilarity(c *gin.Context) {
	var req struct {
		TextA string `json:"text_a" binding:"required"`
		TextB string `json:"text_b" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client := ai.NewClient()
	start := time.Now()

	embA, err := client.GetEmbedding(req.TextA)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Embedding failed for text_a", "detail": err.Error()})
		return
	}
	embB, err := client.GetEmbedding(req.TextB)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Embedding failed for text_b", "detail": err.Error()})
		return
	}

	similarity := ai.CosineSimilarity(embA, embB)
	elapsed := time.Since(start).Milliseconds()

	c.JSON(http.StatusOK, ai.SimilarityResult{
		Score:     similarity,
		TextA:     req.TextA,
		TextB:     req.TextB,
		ElapsedMs: elapsed,
		ModelUsed: os.Getenv("OLLAMA_EMBED_MODEL"),
	})
}

// SaveModelAnswer handles POST /api/v1/ai/model-answer.
func (h *AIHandler) SaveModelAnswer(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	var req struct {
		QuestionID string `json:"question_id" binding:"required"`
		Content    string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client := ai.NewClient()
	emb, err := client.GetEmbedding(req.Content)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to generate embedding", "detail": err.Error()})
		return
	}

	now := time.Now()
	doc := ai.ModelAnswer{
		ID:             uuid.New().String(),
		TenantID:       tenantID,
		QuestionID:     req.QuestionID,
		Content:        req.Content,
		Embedding:      emb,
		EmbeddingCount: len(emb),
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	h.ModelAnswersColl.DeleteMany(ctx, bson.M{"question_id": req.QuestionID, "tenantId": tenantID})

	if _, err := h.ModelAnswersColl.InsertOne(ctx, doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save model answer", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status":          "saved",
		"id":              doc.ID,
		"embedding_count": doc.EmbeddingCount,
	})
}

// CompareWithModelAnswer handles POST /api/v1/ai/compare-answer.
func (h *AIHandler) CompareWithModelAnswer(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	var req struct {
		QuestionID    string `json:"question_id" binding:"required"`
		StudentAnswer string `json:"student_answer" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var ma ai.ModelAnswer
	if err := h.ModelAnswersColl.FindOne(ctx, bson.M{"question_id": req.QuestionID, "tenantId": tenantID}).Decode(&ma); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No model answer found for this question. Upload one first."})
		return
	}

	client := ai.NewClient()
	start := time.Now()

	studentEmb, err := client.GetEmbedding(req.StudentAnswer)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to embed student answer", "detail": err.Error()})
		return
	}

	similarity := ai.CosineSimilarity(ma.Embedding, studentEmb)
	elapsed := time.Since(start).Milliseconds()

	level := "low"
	if similarity >= 0.85 {
		level = "excellent"
	} else if similarity >= 0.7 {
		level = "good"
	} else if similarity >= 0.5 {
		level = "fair"
	}

	c.JSON(http.StatusOK, gin.H{
		"question_id":    req.QuestionID,
		"similarity":     similarity,
		"level":          level,
		"model_answer":   ma.Content,
		"student_answer": req.StudentAnswer,
		"elapsed_ms":     elapsed,
	})
}

// ListModelAnswers handles GET /api/v1/ai/model-answers.
func (h *AIHandler) ListModelAnswers(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := bson.M{"tenantId": tenantID}
	if qID := c.Query("question_id"); qID != "" {
		filter["question_id"] = qID
	}

	cursor, err := h.ModelAnswersColl.Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch model answers"})
		return
	}
	defer cursor.Close(ctx)

	var docs []ai.ModelAnswer
	if err := cursor.All(ctx, &docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode"})
		return
	}

	// Strip embeddings from response
	type safeResponse struct {
		ID             string    `json:"id"`
		TenantID       string    `json:"tenantId"`
		QuestionID     string    `json:"question_id"`
		Content        string    `json:"content"`
		EmbeddingCount int       `json:"embedding_count"`
		CreatedAt      time.Time `json:"created_at"`
		UpdatedAt      time.Time `json:"updated_at"`
	}
	out := make([]safeResponse, len(docs))
	for i, d := range docs {
		out[i] = safeResponse{
			ID: d.ID, TenantID: d.TenantID, QuestionID: d.QuestionID,
			Content: d.Content, EmbeddingCount: d.EmbeddingCount,
			CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, out)
}

func convertOptions(opts []ai.Opt) []models.Option {
	result := make([]models.Option, len(opts))
	for i, o := range opts {
		result[i] = models.Option{ID: o.ID, Text: o.Text}
	}
	return result
}

// cleanJSON extracts the JSON object from a string that may have markdown fences or extra text.
func cleanJSON(raw string) string {
	s := strings.TrimSpace(raw)
	// strip markdown fences
	if start := strings.Index(s, "```json"); start != -1 {
		s = s[start+7:]
		if end := strings.Index(s, "```"); end != -1 {
			s = s[:end]
		}
	} else if start := strings.Index(s, "```"); start != -1 {
		s = s[start+3:]
		if end := strings.Index(s, "```"); end != -1 {
			s = s[:end]
		}
	}
	s = strings.TrimSpace(s)

	// extract outermost {...}
	if len(s) > 0 && s[0] == '{' {
		// walk braces to find matching closing }
		depth := 0
		end := -1
		for i, ch := range s {
			if ch == '{' {
				depth++
			} else if ch == '}' {
				depth--
				if depth == 0 {
					end = i + 1
					break
				}
			}
		}
		if end > 0 {
			s = s[:end]
		}
		// fix trailing comma before }
		s = strings.ReplaceAll(s, ",}", "}")
		// fix trailing comma before ]
		s = strings.ReplaceAll(s, ",]", "]")
		return s
	}
	if start := strings.Index(s, "{"); start != -1 {
		if end := strings.LastIndex(s, "}"); end > start {
			return s[start : end+1]
		}
	}
	return s
}
