import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { AttendanceSession, AttendanceRecord, CourseRegistration } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";
import crypto from "node:crypto";

const SessionBody = z.object({ courseId: z.string().min(1), title: z.string().min(1), date: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() });
const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER, Role.VIEWER];
const writeRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsAttendanceRoutes(app: FastifyInstance) {
  app.get("/attendance/sessions", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const filter: Record<string, unknown> = { tenantId: tid };
    const courseId = (req.query as { courseId?: string }).courseId;
    if (courseId) filter.courseId = courseId;
    const rows = await AttendanceSession.find(filter).sort({ createdAt: -1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/attendance/sessions", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = SessionBody.parse(req.body);
    const qrCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    const qrExpiresAt = new Date(Date.now() + 3600000);
    const s = await AttendanceSession.create({ ...body, tenantId: tid, isActive: true, qrCode, qrExpiresAt, date: body.date ? new Date(body.date) : new Date() });
    return withId(s.toObject() as { _id: string });
  });

  app.get("/attendance/sessions/:id/qr", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const s = await AttendanceSession.findOne({ _id: (req.params as { id: string }).id, tenantId: tid }).lean() as Record<string, any> | null;
    if (!s) return reply.code(404).send({ error: "Not found" });
    return { qrCode: s.qrCode, expiresAt: s.qrExpiresAt };
  });

  app.get("/attendance/sessions/:id/report", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const sessionId = (req.params as { id: string }).id;
    const s = await AttendanceSession.findOne({ _id: sessionId, tenantId: tid }).lean();
    if (!s) return reply.code(404).send({ error: "Not found" });
    const records = await AttendanceRecord.find({ sessionId, tenantId: tid }).lean();
    return { session: withId(s as { _id: string }), records: withIds(records as { _id: string }[]), totalPresent: records.filter(r => r.status === "present").length, totalAbsent: records.filter(r => r.status === "absent").length };
  });

  app.post("/attendance/sessions/:id/checkin", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const sessionId = (req.params as { id: string }).id;
    const s = await AttendanceSession.findOne({ _id: sessionId, tenantId: tid, isActive: true }).lean();
    if (!s) return reply.code(404).send({ error: "Session not found or inactive" });
    try {
      const r = await AttendanceRecord.create({ tenantId: tid, sessionId, studentId: user.sub, status: "present", checkinTime: new Date(), method: "qr" });
      return withId(r.toObject() as { _id: string });
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 11000) return reply.code(409).send({ error: "Already checked in" });
      throw e;
    }
  });

  app.get("/attendance/student/me", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const records = await AttendanceRecord.find({ tenantId: tid, studentId: user.sub }).sort({ checkinTime: -1 }).limit(100).lean();
    const sessionIds = [...new Set(records.map(r => r.sessionId))];
    const sessions = await AttendanceSession.find({ _id: { $in: sessionIds }, tenantId: tid }).lean();
    const sessionMap = new Map(sessions.map(s => [s._id as string, s]));
    return records.map(r => ({ ...r, session: sessionMap.get(r.sessionId as string) ?? null, id: r._id }));
  });
}
