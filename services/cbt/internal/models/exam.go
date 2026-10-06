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

// Section is a named, ordered grouping of questions within an exam (or stream).
// Sections let an exam be split into parts (e.g. "Part A - MCQ", "Part B - Essay")
// each with its own instructions, optional time allocation, and shuffle rule.
type Section struct {
	ID               string     `bson:"sec_id" json:"sec_id"`
	Title            string     `bson:"title" json:"title"`
	Description      string     `bson:"description,omitempty" json:"description,omitempty"`
	DurationMinutes  int        `bson:"duration_minutes,omitempty" json:"duration_minutes,omitempty"` // 0 = inherit exam duration
	ShuffleQuestions bool       `bson:"shuffle_questions,omitempty" json:"shuffle_questions,omitempty"`
	Order            int        `bson:"order" json:"order"`
	Questions        []Question `bson:"questions" json:"questions"`
}

// Stream is an alternate variant (sitting) of an exam used to reduce collusion:
// different rows/groups of students can be assigned different streams. Each stream
// contains its own ordered sections. When streams are present, a student is
// assigned to one stream (default: the first) and only sees its sections.
type Stream struct {
	ID       string    `bson:"str_id" json:"str_id"`
	Name     string    `bson:"name" json:"name"`
	Sections []Section `bson:"sections" json:"sections"`
}

type Exam struct {
	ID                string          `bson:"_id,omitempty" json:"id"`
	TenantID          string          `bson:"tenantId" json:"tenantId"`
	Type              AssessmentType  `bson:"type" json:"type"`
	Rules             AssessmentRules `bson:"rules" json:"rules"`
	Metadata          ExamMetadata    `bson:"metadata" json:"metadata"`
	Questions         []Question      `bson:"questions,omitempty" json:"questions,omitempty"`   // legacy flat list
	Sections          []Section       `bson:"sections,omitempty" json:"sections,omitempty"`      // structured, single-stream
	Streams           []Stream        `bson:"streams,omitempty" json:"streams,omitempty"`        // multiple variants
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

	// HmacSecret is distributed to the mobile app inside the encrypted exam
	// package so it can sign submission/telemetry requests. It is NOT persisted
	// to the database (bson:"-").
	HmacSecret string `bson:"-" json:"hmac_secret,omitempty"`
}

// AllQuestions returns every question regardless of how the exam is structured
// (legacy flat list, sections, or streams). Used by grading/scoring.
func (e *Exam) AllQuestions() []Question {
	out := make([]Question, 0)
	out = append(out, e.Questions...)
	for _, s := range e.Sections {
		out = append(out, s.Questions...)
	}
	for _, st := range e.Streams {
		for _, sec := range st.Sections {
			out = append(out, sec.Questions...)
		}
	}
	return out
}
