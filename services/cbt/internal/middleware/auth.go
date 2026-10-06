package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JwtSecret is loaded from the environment. It must be set in every environment;
// if it is empty the service fails closed (tokens cannot be validated).
var JwtSecret = []byte(os.Getenv("JWT_SECRET"))

// ValidateToken parses and verifies a raw JWT string. It returns the claims or an error.
func ValidateToken(tokenString string) (jwt.MapClaims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return JwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid or expired token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
			c.Abort()
			return
		}

		claims, err := ValidateToken(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		// Extract tenantId and userId from claims. Bio-api issues `sub` (not `userId`),
		// so fall back to `sub` when `userId` is absent to preserve the audit actor.
		tenantId, _ := claims["tenantId"].(string)
		userId, _ := claims["userId"].(string)
		if userId == "" {
			userId, _ = claims["sub"].(string)
		}
		role, _ := claims["role"].(string)

		// If SUPER_ADMIN, allow overriding tenantId via header
		if role == "SUPER_ADMIN" {
			if overrideID := c.GetHeader("X-Tenant-ID"); overrideID != "" {
				tenantId = overrideID
			}
		}

		c.Set("tenantId", tenantId)
		c.Set("userId", userId)
		c.Set("role", role)
		c.Next()
	}
}

// RequireRole aborts the request with 403 unless the authenticated principal's role
// is one of the allowed roles. It must be used after AuthMiddleware.
func RequireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		r, _ := role.(string)
		for _, allowed := range roles {
			if r == allowed {
				c.Next()
				return
			}
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient privileges"})
		c.Abort()
	}
}
