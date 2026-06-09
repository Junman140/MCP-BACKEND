package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type AuthHandler struct{}

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{}
}

func bioAPIURL() string {
	url := os.Getenv("BIOMETRIC_API_URL")
	if url == "" {
		url = "http://127.0.0.1:4111"
	}
	return url
}

func generateServiceJWT(tenantID string) (string, error) {
	claims := jwt.MapClaims{
		"sub":      "cbt-service",
		"tenantId": tenantID,
		"role":     "TENANT_ADMIN",
		"iat":      time.Now().Unix(),
		"exp":      time.Now().Add(5 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(middleware.JwtSecret)
}

// VerifyStudent handles the POST /api/v1/auth/verify request.
// Validates the student's identity against the Biometric API.
func (h *AuthHandler) VerifyStudent(c *gin.Context) {
	var req struct {
		StudentID string `json:"student_id" binding:"required"`
		ExamID    string `json:"exam_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Look up the exam to get the tenantId.
	type examLookup struct {
		TenantID string `bson:"tenantId"`
	}
	var exam examLookup
	if err := db.DB.Collection("cbt_exams").FindOne(ctx, bson.M{"_id": req.ExamID}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Exam not found", "detail": "The exam ID does not exist."})
		return
	}

	// Generate a service JWT to call the Bio API.
	svcToken, err := generateServiceJWT(exam.TenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate service token"})
		return
	}

	// Verify student exists in the Bio system.
	studentURL := fmt.Sprintf("%s/students/%s?tenantId=%s", bioAPIURL(), req.StudentID, exam.TenantID)
	reqCtx, reqCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer reqCancel()

	httpReq, _ := http.NewRequestWithContext(reqCtx, "GET", studentURL, nil)
	httpReq.Header.Set("Authorization", "Bearer "+svcToken)

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cannot reach identity service", "detail": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Student not found", "detail": "The student ID does not exist in the identity system."})
		return
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Identity verification failed", "detail": string(body)})
		return
	}

	var student struct {
		ID       string `json:"id"`
		FullName string `json:"fullName"`
		MatricNo string `json:"matricNo"`
	}
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &student); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse student data"})
		return
	}

	// Check biometric enrollment status.
	enrollURL := fmt.Sprintf("%s/students/%s/enrollments/status?tenantId=%s", bioAPIURL(), req.StudentID, exam.TenantID)
	enrollReq, _ := http.NewRequestWithContext(reqCtx, "GET", enrollURL, nil)
	enrollReq.Header.Set("Authorization", "Bearer "+svcToken)

	enrollResp, err := client.Do(enrollReq)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Cannot check enrollment status", "detail": err.Error()})
		return
	}
	defer enrollResp.Body.Close()

	var enrollment struct {
		Fingerprint bool     `json:"fingerprint"`
		Face        bool     `json:"face"`
		Fingers     []string `json:"fingers"`
	}
	enrollBody, _ := io.ReadAll(enrollResp.Body)
	json.Unmarshal(enrollBody, &enrollment)

	if !enrollment.Fingerprint && !enrollment.Face {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":      "Biometric enrollment required",
			"detail":     "Student has not completed biometric enrollment (fingerprint or face).",
			"student_id": req.StudentID,
		})
		return
	}

	// Generate a CBT session JWT for the student.
	sessionClaims := jwt.MapClaims{
		"sub":       req.StudentID,
		"tenantId":  exam.TenantID,
		"examId":    req.ExamID,
		"fullName":  student.FullName,
		"matricNo":  student.MatricNo,
		"role":      "student",
		"iat":       time.Now().Unix(),
		"exp":       time.Now().Add(6 * time.Hour).Unix(),
	}
	sessionToken := jwt.NewWithClaims(jwt.SigningMethodHS256, sessionClaims)
	sessionStr, err := sessionToken.SignedString(middleware.JwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate session token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       "verified",
		"auth_token":   sessionStr,
		"student": gin.H{
			"id":         student.ID,
			"full_name":  student.FullName,
			"matric_no":  student.MatricNo,
		},
		"has_fingerprint": enrollment.Fingerprint,
		"has_face":        enrollment.Face,
	})
}
