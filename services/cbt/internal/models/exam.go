package models

import (
	"time"
)

type AssessmentType string

const (
	AssessmentTypeExam       AssessmentType = "exam"
	AssessmentTypeTest       AssessmentType = "test"
	AssessmentTypeAssignment AssessmentType = "assignment"
)

type AssessmentRules struct {
	// Exam: typically strict (true). Test/Assignment: often relaxed (false).
	IsProctored bool `bson:"is_proctored" json:"is_proctored"`
	// Test: can be >1. Exam: usually 1. Assignment: usually 1 (or unlimited if desired).
	MaxAttempts int `bson:"max_attempts" json:"max_attempts"`
}

type ExamMetadata struct {
	Title            string `bson:"title" json:"title"`
	DurationMinutes  int    `bson:"duration_minutes" json:"duration_minutes"`
	ShuffleQuestions bool   `bson:"shuffle_questions" json:"shuffle_questions"`
	ShuffleOptions   bool   `bson:"shuffle_options" json:"shuffle_options"`
}

type Option struct {
	ID   string `bson:"opt_id" json:"opt_id"`
	Text string `bson:"text" json:"text"`
}

type FileUploadConstraints struct {
	// Allowed MIME types (e.g. ["application/pdf","image/*"]). Empty means allow any.
	AllowedMimeTypes []string `bson:"allowed_mime_types" json:"allowed_mime_types"`
	// Max size in bytes. 0 means no explicit limit.
	MaxBytes int64 `bson:"max_bytes" json:"max_bytes"`
	// Max number of files for this question. 0 means default 1.
	MaxFiles int `bson:"max_files" json:"max_files"`
}

type Question struct {
	ID         string   `bson:"q_id" json:"q_id"`
	Type       string   `bson:"type" json:"type"`
	Content    string   `bson:"content" json:"content"`
	Media      []string `bson:"media" json:"media"` 
	Options    []Option `bson:"options" json:"options"`
	CorrectID  string   `bson:"correct_opt_id" json:"-"` 
	// Essay answers are submitted via Submissions; never shipped in payload.
	// File uploads are stored and referenced via Submissions.
	Points     int64                 `bson:"points" json:"points"`
	WordLimit  int                   `bson:"word_limit" json:"word_limit"`
	FileUpload *FileUploadConstraints `bson:"file_upload,omitempty" json:"file_upload,omitempty"`
	Difficulty string   `bson:"difficulty" json:"difficulty"`
	Tags       []string `bson:"tags" json:"tags"`
}

type Exam struct {
	ID                string          `bson:"_id,omitempty" json:"id"`
	TenantID          string          `bson:"tenantId" json:"tenantId"`
	Type              AssessmentType  `bson:"type" json:"type"`
	Rules             AssessmentRules `bson:"rules" json:"rules"`
	Metadata          ExamMetadata    `bson:"metadata" json:"metadata"`
	Questions         []Question      `bson:"questions" json:"questions"`
	CourseID          string          `bson:"course_id,omitempty" json:"course_id,omitempty"`
	CourseName        string          `bson:"course_name,omitempty" json:"course_name,omitempty"`
	FacultyID         string          `bson:"faculty_id,omitempty" json:"faculty_id,omitempty"`
	FacultyName       string          `bson:"faculty_name,omitempty" json:"faculty_name,omitempty"`
	DepartmentID      string          `bson:"department_id,omitempty" json:"department_id,omitempty"`
	DepartmentName    string          `bson:"department_name,omitempty" json:"department_name,omitempty"`
	Level             string          `bson:"level,omitempty" json:"level,omitempty"`
	Semester          string          `bson:"semester,omitempty" json:"semester,omitempty"`
	AcademicSessionID string          `bson:"academic_session_id,omitempty" json:"academic_session_id,omitempty"`
	CreatedAt         time.Time       `bson:"created_at" json:"created_at"`
}
