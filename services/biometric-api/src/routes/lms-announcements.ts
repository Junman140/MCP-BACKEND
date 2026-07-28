import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Announcement } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const AnnouncementBody = z.object({ courseId: z.string().min(1), title: z.string().min(1), body: z.string().min(1) });
const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];
const writeRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER];

export async function lmsAnnouncementsRoutes(app: FastifyInstance) {
  app.get("/announcements", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const rows = await Announcement.find({ tenantId: tid }).sort({ createdAt: -1 }).limit(100).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/announcements", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = AnnouncementBody.parse(req.body);
    const a = await Announcement.create({ ...body, tenantId: tid, authorId: user.sub });
    return withId(a.toObject() as { _id: string });
  });

  app.delete("/announcements/:id", { onRequest: [app.authenticate, requireRole(writeRoles)] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await Announcement.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
