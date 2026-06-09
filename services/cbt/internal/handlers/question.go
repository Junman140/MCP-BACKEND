package handlers

import (
	"context"
	"net/http"
	"time"

	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type QuestionHandler struct {
	Coll *mongo.Collection
}

func NewQuestionHandler() *QuestionHandler {
	return &QuestionHandler{
		Coll: db.DB.Collection("cbt_questions"),
	}
}

// CreateQuestion handles POST /api/v1/questions.
func (h *QuestionHandler) CreateQuestion(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	var q models.BankQuestion
	if err := c.ShouldBindJSON(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if q.ID == "" {
		q.ID = uuid.New().String()
	}
	q.TenantID = tenantID
	q.CreatedAt = time.Now()
	q.UpdatedAt = time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := h.Coll.InsertOne(ctx, q); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create question"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "success", "id": q.ID})
}

// ListQuestions handles GET /api/v1/questions.
// Supports optional query filters: type, difficulty, course_id, tags, search.
func (h *QuestionHandler) ListQuestions(c *gin.Context) {
	tenantID := c.GetString("tenantId")

	filter := bson.M{"tenantId": tenantID}
	if qType := c.Query("type"); qType != "" {
		filter["type"] = qType
	}
	if difficulty := c.Query("difficulty"); difficulty != "" {
		filter["difficulty"] = difficulty
	}
	if courseID := c.Query("course_id"); courseID != "" {
		filter["course_id"] = courseID
	}
	if facultyID := c.Query("faculty_id"); facultyID != "" {
		filter["faculty_id"] = facultyID
	}
	if departmentID := c.Query("department_id"); departmentID != "" {
		filter["department_id"] = departmentID
	}
	if level := c.Query("level"); level != "" {
		filter["level"] = level
	}
	if tag := c.Query("tag"); tag != "" {
		filter["tags"] = tag
	}
	if search := c.Query("search"); search != "" {
		filter["content"] = bson.M{"$regex": search, "$options": "i"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := options.Find().SetSort(bson.M{"created_at": -1}).SetLimit(200)
	cursor, err := h.Coll.Find(ctx, filter, opts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch questions"})
		return
	}
	defer cursor.Close(ctx)

	var questions []models.BankQuestion
	if err := cursor.All(ctx, &questions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decode questions"})
		return
	}

	c.JSON(http.StatusOK, questions)
}

// GetQuestion handles GET /api/v1/questions/:id.
func (h *QuestionHandler) GetQuestion(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	id := c.Param("id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var q models.BankQuestion
	if err := h.Coll.FindOne(ctx, bson.M{"_id": id, "tenantId": tenantID}).Decode(&q); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Question not found"})
		return
	}

	c.JSON(http.StatusOK, q)
}

// UpdateQuestion handles PATCH /api/v1/questions/:id.
func (h *QuestionHandler) UpdateQuestion(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	id := c.Param("id")

	var req models.BankQuestion
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	update := bson.M{
		"$set": bson.M{
			"type":           req.Type,
			"content":        req.Content,
			"media":          req.Media,
			"options":        req.Options,
			"correct_opt_id": req.CorrectID,
			"points":         req.Points,
			"word_limit":     req.WordLimit,
			"file_upload":    req.FileUpload,
			"difficulty":     req.Difficulty,
			"tags":           req.Tags,
			"course_id":      req.CourseID,
			"faculty_id":     req.FacultyID,
			"department_id":  req.DepartmentID,
			"level":          req.Level,
			"topic":          req.Topic,
			"updated_at":     time.Now(),
		},
	}

	res, err := h.Coll.UpdateOne(ctx, bson.M{"_id": id, "tenantId": tenantID}, update)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update question"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Question not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

// DeleteQuestion handles DELETE /api/v1/questions/:id.
func (h *QuestionHandler) DeleteQuestion(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	id := c.Param("id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := h.Coll.DeleteOne(ctx, bson.M{"_id": id, "tenantId": tenantID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete question"})
		return
	}
	if res.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Question not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
