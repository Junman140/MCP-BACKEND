import "./loadEnv.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { connectDb } from "./lib/db.js";
import { registerAuth } from "./lib/auth.js";
import { authRoutes } from "./routes/auth.js";
import { tenantRoutes } from "./routes/tenants.js";
import { studentRoutes } from "./routes/students.js";
import { enrollmentRoutes } from "./routes/enrollments.js";
import { deviceRoutes } from "./routes/devices.js";
import { examRoutes } from "./routes/exams.js";
import { verifyRoutes } from "./routes/verify.js";
import { syncRoutes } from "./routes/sync.js";
import { reportRoutes } from "./routes/reports.js";
import { courseRoutes } from "./routes/courses.js";
import { courseRegistrationRoutes } from "./routes/course-registrations.js";
import { facultyRoutes } from "./routes/faculties.js";
import { departmentRoutes } from "./routes/departments.js";
import { academicSessionRoutes } from "./routes/academic-sessions.js";
import { notificationRoutes } from "./routes/notifications.js";

await connectDb();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-in-production",
});

registerAuth(app);

app.get("/health", async () => ({ ok: true, db: "mongodb" }));

await app.register(authRoutes);
await app.register(tenantRoutes);
await app.register(studentRoutes);
await app.register(enrollmentRoutes);
await app.register(deviceRoutes);
await app.register(examRoutes);
await app.register(verifyRoutes);
await app.register(syncRoutes);
await app.register(reportRoutes);
await app.register(courseRoutes);
await app.register(courseRegistrationRoutes);
await app.register(facultyRoutes);
await app.register(departmentRoutes);
await app.register(academicSessionRoutes);
await app.register(notificationRoutes);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const matchingUrl = process.env.MATCHING_SERVICE_URL ?? "http://127.0.0.1:5050";
fetch(`${matchingUrl}/health`, { signal: AbortSignal.timeout(2500) })
  .then((r) => {
    if (!r.ok) app.log.warn({ matchingUrl, msg: "matching service /health not OK" });
    else app.log.info({ matchingUrl, msg: "matching service reachable" });
  })
  .catch(() =>
    app.log.warn({
      matchingUrl,
      msg: "matching service not reachable — start Java SourceAFIS (port 5050) for enrollment and verification",
    })
  );

const faceUrl = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:5056";
fetch(`${faceUrl}/health`, { signal: AbortSignal.timeout(2500) })
  .then((r) => {
    if (!r.ok) app.log.warn({ faceUrl, msg: "face service /health not OK" });
    else app.log.info({ faceUrl, msg: "face service reachable" });
  })
  .catch(() =>
    app.log.warn({
      faceUrl,
      msg: "face service not reachable — start Python face-service (port 5056) for face recognition",
    })
  );
