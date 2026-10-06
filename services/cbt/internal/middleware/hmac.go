package middleware

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// HMACBodyVerify validates X-Signature header on mobile submission endpoints.
// Signature = HMAC-SHA256(request body, shared secret).
//
// Multipart/form-data uploads are exempt from body verification: the raw body
// (a multipart boundary stream) cannot be deterministically reproduced by the
// client for signing. Authenticity for those requests is still enforced by the
// anti-replay nonce (HMAC of timestamp with the shared secret) and the JWT.
func HMACBodyVerify(sharedSecret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		contentType := c.GetHeader("Content-Type")
		isMultipart := strings.Contains(contentType, "multipart/form-data")

		sigHeader := c.GetHeader("X-Signature")
		if sigHeader == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "missing_signature", "detail": "X-Signature header required"})
			return
		}

		if isMultipart {
			c.Next()
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
