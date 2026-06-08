package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"mcp-cbt-backend/internal/db"
	"mcp-cbt-backend/internal/handlers"
	"mcp-cbt-backend/internal/middleware"
	"mcp-cbt-backend/internal/telemetry"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	// Connect to MongoDB
	mongoURI := os.Getenv("MONGODB_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://localhost:27017"
	}
	dbName := "school"
	
	if err := db.Connect(mongoURI, dbName); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	examHandler := handlers.NewExamHandler()
	authHandler := handlers.NewAuthHandler()
	questionHandler := handlers.NewQuestionHandler()
	aiHandler := handlers.NewAIHandler()

	router := gin.Default()

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		// Public auth for mobile app biometric handshake (if needed)
		v1.POST("/auth/verify", authHandler.VerifyStudent)

		// Protected Admin routes
		admin := v1.Group("")
		admin.Use(middleware.AuthMiddleware())
		{
			admin.GET("/stats", examHandler.GetStats)
			admin.GET("/results", examHandler.ListResults)
			admin.GET("/exams", examHandler.ListExams)
			admin.POST("/exams", examHandler.CreateExam)
			admin.GET("/exams/:id/download", examHandler.DownloadExam)
			admin.GET("/submissions", examHandler.ListSubmissions)
			admin.PATCH("/submissions/:id/grade", examHandler.GradeSubmission)

			// Question Bank CRUD
			admin.POST("/questions", questionHandler.CreateQuestion)
			admin.GET("/questions", questionHandler.ListQuestions)
			admin.GET("/questions/:id", questionHandler.GetQuestion)
			admin.PATCH("/questions/:id", questionHandler.UpdateQuestion)
			admin.DELETE("/questions/:id", questionHandler.DeleteQuestion)

			// Media upload for question assets
			admin.POST("/media/upload", examHandler.UploadMedia)

			// AI Question Generation
			admin.GET("/ai/health", aiHandler.Health)
			admin.POST("/ai/generate", aiHandler.Generate)
			admin.POST("/ai/generate-from-text", aiHandler.GenerateFromText)
			admin.POST("/ai/save", aiHandler.SaveGenerated)
			admin.POST("/ai/curriculum", aiHandler.UploadCurriculum)
			admin.GET("/ai/curriculum", aiHandler.ListCurricula)

			// AI Auto-Grading
			admin.POST("/ai/grade-essay", aiHandler.GradeEssay)
			admin.POST("/ai/grade-submission/:id", aiHandler.GradeSubmission)

			// AI Semantic Embedding
			admin.POST("/ai/similarity", aiHandler.ComputeSimilarity)
			admin.POST("/ai/model-answer", aiHandler.SaveModelAnswer)
			admin.GET("/ai/model-answers", aiHandler.ListModelAnswers)
			admin.POST("/ai/compare-answer", aiHandler.CompareWithModelAnswer)
		}

		// Mobile app submissions
		v1.POST("/exams/:id/submit", examHandler.SubmitExam)
		v1.POST("/exams/:id/upload", examHandler.UploadAssignmentFile)
		v1.POST("/telemetry", examHandler.PostTelemetry)
		v1.GET("/telemetry/stream", func(c *gin.Context) {
			telemetry.HandleWebSocket(c.Writer, c.Request)
		})
		v1.GET("/media/*filename", examHandler.ServeMedia)
	}

	// Setup graceful shutdown
	srv := &http.Server{
		Addr:    ":8080",
		Handler: router,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()
	log.Println("Server started on :8080")

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	if err := db.Disconnect(ctx); err != nil {
		log.Fatal("Database forced to disconnect:", err)
	}

	log.Println("Server exiting")
}
