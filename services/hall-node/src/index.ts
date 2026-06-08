import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { HttpCaptureDriver } from "@bio/shared";
import { decryptTemplate } from "./lib/crypto.js";
import { extractTemplate, matchTemplates } from "./lib/matching.js";
import { readCache, writeCache } from "./lib/cache.js";
import { appendPending, readPending, clearPending } from "./lib/queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "15mb" }));
const publicDir = path.join(__dirname, "..", "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

const API = process.env.API_URL ?? "http://127.0.0.1:4000";

const captureBridgeUrl = process.env.CAPTURE_BRIDGE_URL?.trim();
const captureDriver = captureBridgeUrl
  ? new HttpCaptureDriver({ baseUrl: captureBridgeUrl })
  : null;

/** Proxies to local SecuGen (or other) SDK bridge — same machine as the USB reader. */
app.post("/api/capture/device", async (_req, res) => {
  if (!captureDriver) {
    return res.status(503).json({
      error: "No capture bridge",
      hint: "Set CAPTURE_BRIDGE_URL to your local SDK service (see docs/hardware-and-capture.md).",
    });
  }
  try {
    const payload = await captureDriver.capture();
    res.json(payload);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    cache: !!readCache(),
    pending: readPending().length,
    captureBridge: !!captureDriver,
  });
});

/** Pull exam package from central API (device auth). */
app.post("/api/sync/pull", async (req, res) => {
  const examId = (req.body as { examId?: string })?.examId;
  if (!examId) return res.status(400).json({ error: "examId required" });
  const deviceId = process.env.DEVICE_ID;
  const deviceSecret = process.env.DEVICE_SECRET;
  if (!deviceId || !deviceSecret) {
    return res.status(500).json({ error: "Configure DEVICE_ID and DEVICE_SECRET" });
  }
  const url = new URL("/sync/exam-package", API);
  url.searchParams.set("examId", examId);
  const r = await fetch(url, {
    headers: {
      "x-device-id": deviceId,
      "x-device-secret": deviceSecret,
    },
  });
  if (!r.ok) {
    const t = await r.text();
    return res.status(r.status).json({ error: t });
  }
  const pkg = (await r.json()) as Parameters<typeof writeCache>[0];
  writeCache(pkg);
  res.json({ ok: true, students: pkg.students.length });
});

/** Flush queued verification events to API. */
app.post("/api/sync/push", async (_req, res) => {
  const deviceId = process.env.DEVICE_ID;
  const deviceSecret = process.env.DEVICE_SECRET;
  if (!deviceId || !deviceSecret) {
    return res.status(500).json({ error: "Configure DEVICE_ID and DEVICE_SECRET" });
  }
  const events = readPending();
  if (!events.length) return res.json({ ok: true, pushed: 0 });
  const r = await fetch(`${API}/sync/verification-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": deviceId,
      "x-device-secret": deviceSecret,
    },
    body: JSON.stringify({ events }),
  });
  if (!r.ok) {
    const t = await r.text();
    return res.status(r.status).json({ error: t });
  }
  clearPending();
  res.json(await r.json());
});

/** Offline-first verify using local cache + local matching service. */
app.post("/api/verify/local", async (req, res) => {
  const body = req.body as {
    matricNo: string;
    examId?: string;
    imageBase64: string;
    width: number;
    height: number;
    dpi?: number;
    format?: "png" | "raw_gray8";
    matchThreshold?: number;
  };
  const cache = readCache();
  if (!cache) return res.status(400).json({ error: "No cached exam package; run sync" });
  const st = cache.students.find((s) => s.matricNo === body.matricNo);
  if (!st) {
    return res.json({ result: "no_student", matchScore: null });
  }
  if (body.examId && body.examId !== cache.examId) {
    return res.status(400).json({ error: "examId does not match cached package" });
  }
  if (cache.courseId && cache.academicYear != null && cache.semester != null && !st.eligibleForExam) {
    return res.json({
      result: "not_registered_for_course",
      matchScore: null,
      courseId: cache.courseId,
      academicYear: cache.academicYear,
      semester: cache.semester,
    });
  }

  const probe = await extractTemplate({
    imageBase64: body.imageBase64,
    width: body.width,
    height: body.height,
    dpi: body.dpi ?? 500,
    format: body.format ?? "png",
  });
  const threshold = body.matchThreshold ?? 20;
  let best = -1;
  let matched = false;
  for (const e of st.enrollments) {
    const raw = decryptTemplate(Buffer.from(e.templateEncBase64, "base64"));
    const m = await matchTemplates(probe.template_base64, raw.toString("base64"), threshold);
    if (m.score > best) best = m.score;
    if (m.matched) matched = true;
  }
  const result = matched ? "match" : "no_match";
  appendPending({
    studentId: st.studentId,
    examId: cache.examId,
    courseId: cache.courseId ?? undefined,
    academicYear: cache.academicYear ?? undefined,
    semester: cache.semester ?? undefined,
    result,
    matchScore: best,
    capturedAt: new Date().toISOString(),
    idempotencyKey: `${st.studentId}-${Date.now()}`,
  });
  res.json({
    result,
    matchScore: best,
    student: {
      matricNo: st.matricNo,
      fullName: st.fullName,
      photoUrl: st.photoUrl,
    },
  });
});

const port = Number(process.env.HALL_PORT ?? 4100);
app.listen(port, () => {
  console.log(`Hall node listening on ${port}`);
});
