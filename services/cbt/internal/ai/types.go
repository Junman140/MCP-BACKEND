package ai

import "time"

type GenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format,omitempty"`
}

type GenerateResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

type QuestionGenParams struct {
	Topic       string   `json:"topic"`
	Difficulty  string   `json:"difficulty"`
	Count       int      `json:"count"`
	Types       []string `json:"types"`
	ContextText string   `json:"context_text,omitempty"`
	CourseName  string   `json:"course_name,omitempty"`
}

type GeneratedQuestion struct {
	Type       string   `json:"type"`
	Content    string   `json:"content"`
	Options    []Opt    `json:"options,omitempty"`
	CorrectID  string   `json:"correct_opt_id,omitempty"`
	Points     int64    `json:"points"`
	WordLimit  int      `json:"word_limit,omitempty"`
	Difficulty string   `json:"difficulty"`
	Tags       []string `json:"tags"`
	Topic      string   `json:"topic"`
}

type Opt struct {
	ID   string `json:"opt_id"`
	Text string `json:"text"`
}

type QuestionGenResponse struct {
	Questions  []GeneratedQuestion `json:"questions"`
	RawOutput  string              `json:"raw_output"`
	ElapsedMs  int64               `json:"elapsed_ms"`
	ModelUsed  string              `json:"model_used"`
}

type GenerateFromTextParams struct {
	Text       string `json:"text"`
	Count      int    `json:"count"`
	Difficulty string `json:"difficulty"`
	Types      []string `json:"types"`
}

type CurriculumUpload struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenantId"`
	CourseID   string    `json:"course_id"`
	Title      string    `json:"title"`
	Content    string    `json:"content"`
	SourceType string    `json:"source_type"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Auto-grading types

type GradeEssayParams struct {
	QuestionText  string `json:"question_text"`
	StudentAnswer string `json:"student_answer"`
	MaxPoints     int64  `json:"max_points"`
	WordLimit     int    `json:"word_limit"`
	ModelAnswer   string `json:"model_answer,omitempty"`
	Rubric        string `json:"rubric,omitempty"`
}

type GradeResult struct {
	Score            int64    `json:"score"`
	MaxPoints        int64    `json:"max_points"`
	Feedback         string   `json:"feedback"`
	Confidence       float64  `json:"confidence"`
	KeyPointsCovered []string `json:"key_points_covered,omitempty"`
	MissedPoints     []string `json:"missed_points,omitempty"`
}

type SubmissionGradeResult struct {
	SubmissionID string             `json:"submission_id"`
	PerQuestion  map[string]int64   `json:"per_question"`
	PerFeedback  map[string]string  `json:"per_feedback"`
	Confidences  map[string]float64 `json:"confidences"`
	TotalScore   int64              `json:"total_score"`
	MaxScore     int64              `json:"max_score"`
	ElapsedMs    int64              `json:"elapsed_ms"`
}

// Embedding types

type EmbeddingRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

type EmbeddingResponse struct {
	Embedding []float64 `json:"embedding"`
}

type SimilarityResult struct {
	Score       float64 `json:"score"`
	TextA       string  `json:"text_a"`
	TextB       string  `json:"text_b"`
	ElapsedMs   int64   `json:"elapsed_ms"`
	ModelUsed   string  `json:"model_used"`
}

type ModelAnswer struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenantId"`
	QuestionID     string    `json:"question_id"`
	Content        string    `json:"content"`
	Embedding      []float64 `json:"-"`
	EmbeddingCount int       `json:"embedding_count"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
