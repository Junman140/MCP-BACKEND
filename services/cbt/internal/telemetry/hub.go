package telemetry

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type TelemetryEvent struct {
	StudentID string    `json:"student_id"`
	ExamID    string    `json:"exam_id"`
	Status    string    `json:"status"`
	Focus     bool      `json:"focus"`
	Violation string    `json:"violation,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]string // conn -> exam_id filter (empty = all)
}

var DefaultHub = &Hub{
	clients: make(map[*websocket.Conn]string),
}

func (h *Hub) AddClient(conn *websocket.Conn, examFilter string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[conn] = examFilter
}

func (h *Hub) RemoveClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, conn)
	conn.Close()
}

func (h *Hub) Broadcast(event TelemetryEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("[Telemetry] Marshal error: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn, examFilter := range h.clients {
		if examFilter != "" && examFilter != event.ExamID {
			continue
		}
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("[Telemetry] Write error to %s: %v", conn.RemoteAddr(), err)
			go h.RemoveClient(conn)
		}
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Telemetry] Upgrade error: %v", err)
		return
	}

	examFilter := r.URL.Query().Get("exam_id")
	DefaultHub.AddClient(conn, examFilter)
	log.Printf("[Telemetry] Client connected (exam=%q, total=%d)", examFilter, DefaultHub.ClientCount())

	// Keep connection alive, read pings
	go func() {
		defer DefaultHub.RemoveClient(conn)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}
