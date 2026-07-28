import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { GradeEntry } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const GradeBody = z.object({ studentId: z.string().min(1), courseId: z.string().min(1), type: z.enum(["assignment","quiz","exam","participation"]), score: z.number(), maxScore: z.number().optional(), letterGrade: z.string().optional(), comments: z.string().optional() });
const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER, Role.VIEWER];
const writeRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsGradesRoutes(app: FastifyInstance) {
  app.get("/grades", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const filter: Record<string, unknown> = { tenantId: tid };
    const courseId = (req.query as { courseId?: string; studentId?: string }).courseId;
    const studentId = (req.query as { studentId?: string }).studentId;
    if (courseId) filter.courseId = courseId;
    if (studentId) filter.studentId = studentId;
    const rows = await GradeEntry.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/grades", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = GradeBody.parse(req.body);
    const g = await GradeEntry.create({ ...body, tenantId: tid, gradedById: user.sub, maxScore: body.maxScore ?? 100 });
    return withId(g.toObject() as { _id: string });
  });

  app.post("/grades/:id/approve", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const g = await GradeEntry.findOneAndUpdate(
      { _id: (req.params as { id: string }).id, tenantId: tid },
      { $set: { isApproved: true, approvedById: user.sub } },
      { new: true }
    ).lean();
    if (!g) return reply.code(404).send({ error: "Not found" });
    return withId(g as { _id: string });
  });
}
