import type { FastifyInstance } from "fastify";

let reqTotal = 0;
let reqActive = 0;
const latencyBuckets = new Uint32Array([0, 0, 0, 0, 0, 0, 0]); // <10, <25, <50, <100, <250, <500, >=500 ms
const startTime = Date.now();

const buckets = [10, 25, 50, 100, 250, 500];

function recordLatency(ms: number) {
  for (let i = 0; i < buckets.length; i++) {
    if (ms <= buckets[i]) {
      latencyBuckets[i]!++;
      return;
    }
  }
  latencyBuckets[6]!++; // >=500ms
}

export async function metricsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async () => {
    reqTotal++;
    reqActive++;
  });

  app.addHook("onResponse", async (request, reply) => {
    reqActive--;
    const duration = reply.elapsedTime;
    recordLatency(duration);
  });

  app.get("/metrics", async (_request, reply) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();

    const lines = [
      "# HELP bio_api_uptime_seconds Service uptime",
      "# TYPE bio_api_uptime_seconds gauge",
      `bio_api_uptime_seconds ${uptime}`,
      "# HELP bio_api_requests_total Total HTTP requests",
      "# TYPE bio_api_requests_total counter",
      `bio_api_requests_total ${reqTotal}`,
      "# HELP bio_api_requests_active Active HTTP requests",
      "# TYPE bio_api_requests_active gauge",
      `bio_api_requests_active ${reqActive}`,
      "# HELP bio_api_request_duration_ms_bucket Latency histogram",
      "# TYPE bio_api_request_duration_ms_bucket histogram",
      ...buckets.map((b, i) => `bio_api_request_duration_ms_bucket{le="${b}"} ${latencyBuckets[i]}`),
      `bio_api_request_duration_ms_bucket{le="+Inf"} ${latencyBuckets[6]}`,
      "# HELP bio_api_memory_heap_bytes Heap memory usage",
      "# TYPE bio_api_memory_heap_bytes gauge",
      `bio_api_memory_heap_bytes ${mem.heapUsed}`,
      "# HELP bio_api_memory_rss_bytes RSS memory usage",
      "# TYPE bio_api_memory_rss_bytes gauge",
      `bio_api_memory_rss_bytes ${mem.rss}`,
      "",
    ];

    return reply.type("text/plain; version=0.0.4").send(lines.join("\n"));
  });
}
