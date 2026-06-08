package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var JwtSecret = func() []byte {
	key := os.Getenv("JWT_SECRET")
	if key == "" {
		key = "change-me-in-production"
	}
	return []byte(key)
}()

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

		tokenString := parts[1]
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return JwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		// Extract tenantId and userId from claims
		tenantId, _ := claims["tenantId"].(string)
		userId, _ := claims["userId"].(string)
		role, _ := claims["role"].(string)

		// If SUPER_ADMIN, allow overriding tenantId via header
		if role == "SUPER_ADMIN" {
			if overrideID := c.GetHeader("X-Tenant-ID"); overrideID != "" {
				tenantId = overrideID
			}
		}

		c.Set("tenantId", tenantId)
		c.Set("userId", userId)
		c.Next()
	}
}
