package middleware

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// HMACBodyVerify validates X-Signature header on mobile submission endpoints.
// Signature = HMAC-SHA256(request body, shared secret).
func HMACBodyVerify(sharedSecret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		sigHeader := c.GetHeader("X-Signature")
		if sigHeader == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "missing_signature", "detail": "X-Signature header required"})
			return
		}

		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "bad_body"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		mac := hmac.New(sha256.New, sharedSecret)
		mac.Write(bodyBytes)
		expected := hex.EncodeToString(mac.Sum(nil))

		if !hmac.Equal([]byte(sigHeader), []byte(expected)) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid_signature", "detail": "Request body signature mismatch"})
			return
		}

		c.Next()
	}
}

// HMACSign generates an HMAC-SHA256 signature for a payload.
func HMACSign(payload []byte, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
