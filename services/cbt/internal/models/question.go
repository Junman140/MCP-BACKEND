package models

import "time"

type BankQuestion struct {
	ID             string                 `bson:"_id,omitempty" json:"id"`
	TenantID       string                 `bson:"tenantId" json:"tenantId"`
	Type           string                 `bson:"type" json:"type"`
	Content        string                 `bson:"content" json:"content"`
	Media          []string               `bson:"media" json:"media"`
	Options        []Option               `bson:"options" json:"options"`
	CorrectID      string                 `bson:"correct_opt_id" json:"-"`
	Points         int64                  `bson:"points" json:"points"`
	WordLimit      int                    `bson:"word_limit" json:"word_limit"`
	FileUpload     *FileUploadConstraints `bson:"file_upload,omitempty" json:"file_upload,omitempty"`
	Difficulty     string                 `bson:"difficulty" json:"difficulty"`
	Tags           []string               `bson:"tags" json:"tags"`
	CourseID       string                 `bson:"course_id" json:"course_id"`
	FacultyID      string                 `bson:"faculty_id,omitempty" json:"faculty_id,omitempty"`
	DepartmentID   string                 `bson:"department_id,omitempty" json:"department_id,omitempty"`
	Level          string                 `bson:"level,omitempty" json:"level,omitempty"`
	Topic          string                 `bson:"topic" json:"topic"`
	CreatedAt      time.Time              `bson:"created_at" json:"created_at"`
	UpdatedAt      time.Time              `bson:"updated_at" json:"updated_at"`
}

type QuestionRef struct {
	QuestionID string `json:"question_id" bson:"question_id"`
	Points     int64  `json:"points" bson:"points"`
}
