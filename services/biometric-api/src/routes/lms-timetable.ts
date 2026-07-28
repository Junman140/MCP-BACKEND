import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { TimetableEntry } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const EntryBody = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1),
  dayOfWeek: z.enum(["mon","tue","wed","thu","fri","sat","sun"]),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  location: z.string().optional(),
  lecturerId: z.string().optional(),
});

const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];
const writeRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsTimetableRoutes(app: FastifyInstance) {
  app.get("/timetable", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const rows = await TimetableEntry.find({ tenantId: tid }).sort({ dayOfWeek: 1, startTime: 1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/timetable", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = EntryBody.parse(req.body);
    const t = await TimetableEntry.create({ ...body, tenantId: tid });
    return withId(t.toObject() as { _id: string });
  });

  app.delete("/timetable/:id", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await TimetableEntry.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
