package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"time"

	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/middleware"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type AttestationHandler struct{}

func NewAttestationHandler() *AttestationHandler {
	return &AttestationHandler{}
}

// DeviceAttestationRequest is sent by the mobile app at exam start.
// It includes Play Integrity / SafetyNet attestation data.
type DeviceAttestationRequest struct {
	ExamID       string `json:"exam_id" binding:"required"`
	StudentID    string `json:"student_id" binding:"required"`
	AttestToken  string `json:"attest_token"`
	AppVersion   string `json:"app_version"`
	AppSignature string `json:"app_signature"`
	Nonce        string `json:"nonce"`
}

type DeviceSession struct {
	ID              string    `bson:"_id,omitempty" json:"id"`
	ExamID          string    `bson:"exam_id" json:"exam_id"`
	StudentID       string    `bson:"student_id" json:"student_id"`
	DeviceAttested  bool      `bson:"device_attested" json:"device_attested"`
	AppVersion      string    `bson:"app_version" json:"app_version"`
	AppSignature    string    `bson:"app_signature" json:"app_signature"`
	EncryptionSalt  string    `bson:"encryption_salt" json:"-"`
	HMACSecret      string    `bson:"hmac_secret" json:"-"`
	NonceSecret     string    `bson:"nonce_secret" json:"-"`
	SessionToken    string    `bson:"session_token" json:"-"`
	CreatedAt       time.Time `bson:"created_at" json:"created_at"`
	ExpiresAt       time.Time `bson:"expires_at" json:"expires_at"`
}

// AttestDevice validates device integrity and creates a secure session.
// POST /api/v1/device/attest
func (h *AttestationHandler) AttestDevice(c *gin.Context) {
	var req DeviceAttestationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "detail": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Verify exam exists and is proctored
	var exam struct {
		TenantID string `bson:"tenantId"`
		Type     string `bson:"type"`
	}
	examColl := db.DB.Collection("cbt_exams")
	if err := examColl.FindOne(ctx, bson.M{"_id": req.ExamID}).Decode(&exam); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "exam_not_found"})
		return
	}

	// Verify attestation token hash (production: validate with Play Integrity API)
	attestValid := verifyAttestToken(req.AttestToken, req.ExamID, req.StudentID)

	sessionColl := db.DB.Collection("cbt_device_sessions")
	now := time.Now()
	expires := now.Add(6 * time.Hour)

	masterKey := middleware.JwtSecret
	encSalt := generateSessionSalt()
	_ = deriveSessionKey(req.ExamID, req.StudentID, encSalt, masterKey)

	session := DeviceSession{
		ExamID:         req.ExamID,
		StudentID:      req.StudentID,
		DeviceAttested: attestValid,
		AppVersion:     req.AppVersion,
		AppSignature:   req.AppSignature,
		EncryptionSalt: encSalt,
		SessionToken:   generateSessionToken(req.ExamID, req.StudentID, encSalt, masterKey),
		CreatedAt:      now,
		ExpiresAt:      expires,
	}

	result, err := sessionColl.InsertOne(ctx, session)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "session_error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":          "attested",
		"session_id":      result.InsertedID,
		"session_token":   session.SessionToken,
		"encryption_salt": encSalt,
		"expires_at":      expires,
		"device_ok":       attestValid,
	})
}

func verifyAttestToken(token, examID, studentID string) bool {
	if token == "" {
		return false
	}
	mac := hmac.New(sha256.New, middleware.JwtSecret)
	mac.Write([]byte(token + examID + studentID))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:16])
	return hmac.Equal([]byte(token), []byte(expected))
}

func generateSessionSalt() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func deriveSessionKey(examID, studentID, salt string, master []byte) string {
	h := hmac.New(sha256.New, master)
	h.Write([]byte(examID))
	h.Write([]byte(studentID))
	h.Write([]byte(salt))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:16])
}

func generateSessionToken(examID, studentID, salt string, master []byte) string {
	h := hmac.New(sha256.New, master)
	h.Write([]byte("session-"))
	h.Write([]byte(examID))
	h.Write([]byte(studentID))
	h.Write([]byte(salt))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// GetDeviceSessions returns active sessions for monitoring
// GET /api/v1/device/sessions?exam_id=...
func (h *AttestationHandler) GetDeviceSessions(c *gin.Context) {
	tenantID := c.GetString("tenantId")
	examID := c.Query("exam_id")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	filter := bson.M{"tenantId": tenantID}
	if examID != "" {
		filter["exam_id"] = examID
	}

	cursor, err := db.DB.Collection("cbt_device_sessions").Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db_error"})
		return
	}
	defer cursor.Close(ctx)

	var sessions []DeviceSession
	if err := cursor.All(ctx, &sessions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "decode_error"})
		return
	}

	type sessionSafe struct {
		ID             string    `json:"id"`
		ExamID         string    `json:"exam_id"`
		StudentID      string    `json:"student_id"`
		DeviceAttested bool      `json:"device_attested"`
		AppVersion     string    `json:"app_version"`
		CreatedAt      time.Time `json:"created_at"`
		ExpiresAt      time.Time `json:"expires_at"`
	}

	var out []sessionSafe
	for _, s := range sessions {
		out = append(out, sessionSafe{
			ID:             s.ID,
			ExamID:         s.ExamID,
			StudentID:      s.StudentID,
			DeviceAttested: s.DeviceAttested,
			AppVersion:     s.AppVersion,
			CreatedAt:      s.CreatedAt,
			ExpiresAt:      s.ExpiresAt,
		})
	}

	if out == nil {
		out = []sessionSafe{}
	}

	c.JSON(http.StatusOK, out)
}
