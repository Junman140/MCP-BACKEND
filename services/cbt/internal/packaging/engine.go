package packaging

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mcp-cbt-backend/internal/crypto"
	"mcp-cbt-backend/internal/models"
	"os"
	"path/filepath"
)

// PackageExam creates an encrypted .mcp archive for an exam
func PackageExam(exam models.Exam, mediaDir string, encryptionKey []byte) ([]byte, error) {
	buf := new(bytes.Buffer)
	zipWriter := zip.NewWriter(buf)

	// 1. Add exam_data.json
	examData, err := json.MarshalIndent(exam, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal exam data: %w", err)
	}

	f, err := zipWriter.Create("exam_data.json")
	if err != nil {
		return nil, fmt.Errorf("failed to create exam_data.json in zip: %w", err)
	}
	if _, err := f.Write(examData); err != nil {
		return nil, fmt.Errorf("failed to write exam_data.json: %w", err)
	}

	// 2. Add media files
	for _, question := range exam.Questions {
		for _, mediaPath := range question.Media {
			// In a real system, we'd ensure these are already WebP
			fullPath := filepath.Join(mediaDir, mediaPath)
			if err := addFileToZip(zipWriter, fullPath, mediaPath); err != nil {
				return nil, fmt.Errorf("failed to add media %s: %w", mediaPath, err)
			}
		}
	}

	if err := zipWriter.Close(); err != nil {
		return nil, fmt.Errorf("failed to close zip writer: %w", err)
	}

	// 3. Encrypt the zip archive
	encryptedData, err := crypto.Encrypt(buf.Bytes(), encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt archive: %w", err)
	}

	return encryptedData, nil
}

func addFileToZip(zw *zip.Writer, fullPath, zipPath string) error {
	file, err := os.Open(fullPath)
	if err != nil {
		return err
	}
	defer file.Close()

	wr, err := zw.Create(zipPath)
	if err != nil {
		return err
	}

	_, err = io.Copy(wr, file)
	return err
}
