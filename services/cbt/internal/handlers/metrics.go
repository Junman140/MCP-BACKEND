package handlers

import (
	"fmt"
	"net/http"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	startTime  = time.Now()
	reqTotal   uint64
	reqActive  int64
	reqLatency uint64 // cumulative microseconds, approximate
)

func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		atomic.AddUint64(&reqTotal, 1)
		atomic.AddInt64(&reqActive, 1)
		start := time.Now()
		c.Next()
		atomic.AddInt64(&reqActive, -1)
		atomic.AddUint64(&reqLatency, uint64(time.Since(start).Microseconds()))
	}
}

// MetricsHandler returns a prometheus-compatible /metrics endpoint.
func MetricsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)

		total := atomic.LoadUint64(&reqTotal)
		active := atomic.LoadInt64(&reqActive)
		latencySum := atomic.LoadUint64(&reqLatency)
		uptime := time.Since(startTime).Seconds()

		avgLatency := float64(0)
		if total > 0 {
			avgLatency = float64(latencySum) / float64(total) / 1000.0 // microseconds -> ms
		}

		c.Header("Content-Type", "text/plain; version=0.0.4")
		c.String(http.StatusOK, fmt.Sprintf(
			"# HELP cbt_api_uptime_seconds Service uptime\n"+
				"# TYPE cbt_api_uptime_seconds gauge\n"+
				"cbt_api_uptime_seconds %.0f\n"+
				"# HELP cbt_api_requests_total Total HTTP requests\n"+
				"# TYPE cbt_api_requests_total counter\n"+
				"cbt_api_requests_total %d\n"+
				"# HELP cbt_api_requests_active Active HTTP requests\n"+
				"# TYPE cbt_api_requests_active gauge\n"+
				"cbt_api_requests_active %d\n"+
				"# HELP cbt_api_request_duration_ms_avg Average request duration\n"+
				"# TYPE cbt_api_request_duration_ms_avg gauge\n"+
				"cbt_api_request_duration_ms_avg %.2f\n"+
				"# HELP cbt_api_goroutines Number of goroutines\n"+
				"# TYPE cbt_api_goroutines gauge\n"+
				"cbt_api_goroutines %d\n"+
				"# HELP cbt_api_memory_alloc_bytes Allocated heap memory\n"+
				"# TYPE cbt_api_memory_alloc_bytes gauge\n"+
				"cbt_api_memory_alloc_bytes %d\n"+
				"# HELP cbt_api_memory_sys_bytes Total memory from OS\n"+
				"# TYPE cbt_api_memory_sys_bytes gauge\n"+
				"cbt_api_memory_sys_bytes %d\n",
			uptime, total, active, avgLatency,
			runtime.NumGoroutine(), m.Alloc, m.Sys,
		))
	}
}
