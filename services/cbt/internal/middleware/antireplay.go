package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type AntiReplay struct {
	mu     sync.RWMutex
	nonces map[string]time.Time
}

var replayGuard = &AntiReplay{
	nonces: make(map[string]time.Time),
}

func init() {
	go replayGuard.periodicCleanup()
}

func (a *AntiReplay) periodicCleanup() {
	tick := time.NewTicker(5 * time.Minute)
	for range tick.C {
		a.mu.Lock()
		cutoff := time.Now().Add(-10 * time.Minute)
		for k, t := range a.nonces {
			if t.Before(cutoff) {
				delete(a.nonces, k)
			}
		}
		a.mu.Unlock()
	}
}

func (a *AntiReplay) isFresh(nonce string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, exists := a.nonces[nonce]; exists {
		return false
	}
	a.nonces[nonce] = time.Now()
	return true
}

// Nonce generates a time-based nonce for mobile to include with requests.
func Nonce(secret []byte) string {
	ts := time.Now().UTC().Unix()
	h := sha256.Sum256(append([]byte{byte(ts)}, secret...))
	return hex.EncodeToString(h[:])[:16]
}

// AntiReplayMiddleware validates X-Nonce and X-Timestamp headers.
// Client sends X-Timestamp (unix seconds) and X-Nonce (HMAC-SHA256(timestamp, shared_secret)).
// Server verifies the nonce and ensures the timestamp is within ±5 minutes.
func AntiReplayMiddleware(sharedSecret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		tsHeader := c.GetHeader("X-Timestamp")
		nonceHeader := c.GetHeader("X-Nonce")

		if tsHeader == "" || nonceHeader == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "missing_nonce", "detail": "X-Timestamp and X-Nonce headers required"})
			return
		}

		var ts int64
		if _, err := fmt.Sscanf(tsHeader, "%d", &ts); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_nonce", "detail": "Invalid timestamp"})
			return
		}

		now := time.Now().UTC().Unix()
		drift := now - ts
		if drift > 300 || drift < -300 {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "clock_skew", "detail": "Device clock is too far from server time"})
			return
		}

		expected := fmt.Sprintf("%x", sha256.Sum256(append([]byte(tsHeader), sharedSecret...)))[:16]
		if nonceHeader != expected {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid_nonce", "detail": "Invalid request signature"})
			return
		}

		if !replayGuard.isFresh(nonceHeader) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "replay", "detail": "Request already processed"})
			return
		}

		c.Next()
	}
}
