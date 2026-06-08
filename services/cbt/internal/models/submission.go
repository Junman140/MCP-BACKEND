package models

import "time"

type SubmissionStatus string

const (
	SubmissionStatusInProgress SubmissionStatus = "in_progress"
	SubmissionStatusSubmitted  SubmissionStatus = "submitted"
	SubmissionStatusGraded     SubmissionStatus = "graded"
)

type Answer struct {
	QuestionID       string    `bson:"question_id" json:"question_id"`
	SelectedOptionID string    `bson:"selected_option_id,omitempty" json:"selected_option_id,omitempty"`
	EssayText        string    `bson:"essay_text,omitempty" json:"essay_text,omitempty"`
	Timestamp        time.Time `bson:"timestamp" json:"timestamp"`
}

type FileUploadRef struct {
	QuestionID string `bson:"question_id" json:"question_id"`
	FileName   string `bson:"file_name" json:"file_name"`
	MimeType   string `bson:"mime_type" json:"mime_type"`
	SizeBytes  int64  `bson:"size_bytes" json:"size_bytes"`
	StorageKey string `bson:"storage_key" json:"storage_key"`
}

type SubmissionGrade struct {
	TotalScore int64             `bson:"total_score" json:"total_score"`
	Feedback   string            `bson:"feedback" json:"feedback"`
	ByUserID   string            `bson:"by_user_id" json:"by_user_id"`
	At         time.Time         `bson:"at" json:"at"`
	PerQuestion map[string]int64 `bson:"per_question,omitempty" json:"per_question,omitempty"`
}

type Submission struct {
	ID           string           `bson:"_id,omitempty" json:"id"`
	TenantID     string           `bson:"tenantId" json:"tenantId"`
	AssessmentID string           `bson:"assessment_id" json:"assessment_id"`
	StudentID    string           `bson:"student_id" json:"student_id"`
	Attempt      int              `bson:"attempt" json:"attempt"`
	Status       SubmissionStatus `bson:"status" json:"status"`

	Answers      []Answer        `bson:"answers" json:"answers"`
	FileUploads  []FileUploadRef `bson:"file_uploads,omitempty" json:"file_uploads,omitempty"`

	StartedAt   time.Time        `bson:"started_at" json:"started_at"`
	SubmittedAt *time.Time       `bson:"submitted_at,omitempty" json:"submitted_at,omitempty"`
	Grade       *SubmissionGrade `bson:"grade,omitempty" json:"grade,omitempty"`
	CreatedAt   time.Time        `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time        `bson:"updated_at" json:"updated_at"`
}

