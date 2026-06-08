package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"time"
)

var (
	OllamaURL   = getEnv("OLLAMA_URL", "http://localhost:11434")
	OllamaModel = getEnv("OLLAMA_MODEL", "gemma2:12b")
	HTTPTimeout = 120 * time.Second
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type Client struct {
	BaseURL string
	Model   string
	http    *http.Client
}

func NewClient() *Client {
	return &Client{
		BaseURL: OllamaURL,
		Model:   OllamaModel,
		http:    &http.Client{Timeout: HTTPTimeout},
	}
}

func NewClientWithModel(model string) *Client {
	return &Client{
		BaseURL: OllamaURL,
		Model:   model,
		http:    &http.Client{Timeout: HTTPTimeout},
	}
}

func (c *Client) Generate(prompt string, jsonMode bool) (*GenerateResponse, error) {
	req := GenerateRequest{
		Model:  c.Model,
		Prompt: prompt,
		Stream: false,
	}
	if jsonMode {
		req.Format = "json"
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/api/generate", c.BaseURL)
	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama request failed: %w (is Ollama running at %s?)", err, c.BaseURL)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama error %d: %s", resp.StatusCode, string(errBody))
	}

	var genResp GenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&genResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &genResp, nil
}

func (c *Client) HealthCheck() bool {
	resp, err := c.http.Get(c.BaseURL + "/api/tags")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (c *Client) GetEmbedding(text string) ([]float64, error) {
	model := os.Getenv("OLLAMA_EMBED_MODEL")
	if model == "" {
		model = "nomic-embed-text"
	}

	req := EmbeddingRequest{
		Model:  model,
		Prompt: text,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	url := fmt.Sprintf("%s/api/embeddings", c.BaseURL)
	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embedding request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("embedding request failed: %w (is Ollama running and is %s pulled?)", err, model)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding error %d: %s", resp.StatusCode, string(errBody))
	}

	var embResp EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&embResp); err != nil {
		return nil, fmt.Errorf("decode embedding: %w", err)
	}

	return embResp.Embedding, nil
}

func CosineSimilarity(a, b []float64) float64 {
	if len(a) == 0 || len(b) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, normA, normB float64
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}
