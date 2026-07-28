import type { FastifyInstance } from "fastify";
import { Role } from "../models/roles.js";
import { StudentProgress, ContentItem } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId } from "../lib/serialize.js";

const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];

export async function lmsProgressRoutes(app: FastifyInstance) {
  app.get("/student/progress/:courseId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const courseId = (req.params as { courseId: string }).courseId;
    let progress = await StudentProgress.findOne({ tenantId: tid, studentId: user.sub, courseId }).lean();
    if (!progress) {
      return withId({ _id: null as any, studentId: user.sub, courseId, completedItemIds: [], completionPercentage: 0, createdAt: new Date(), updatedAt: new Date() } as any);
    }
    return withId(progress as { _id: string });
  });

  app.post("/student/progress/:courseId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const courseId = (req.params as { courseId: string }).courseId;
    const body = req.body as { itemId?: string; completed?: boolean };
    if (!body.itemId) return reply.code(400).send({ error: "itemId is required" });

    const item = await ContentItem.findById(body.itemId).lean();
    if (!item) return reply.code(404).send({ error: "Content item not found" });

    let progress = await StudentProgress.findOne({ tenantId: tid, studentId: user.sub, courseId });
    if (!progress) {
      progress = await StudentProgress.create({ tenantId: tid, studentId: user.sub, courseId, completedItemIds: [], completionPercentage: 0 });
    }

    const ids = new Set(progress.completedItemIds.map(String));
    if (body.completed !== false) {
      ids.add(body.itemId);
    } else {
      ids.delete(body.itemId);
    }
    progress.completedItemIds = Array.from(ids);
    progress.lastAccessedItemId = body.itemId;

    const totalItems = await ContentItem.countDocuments({ tenantId: tid, moduleId: { $exists: true } });
    progress.completionPercentage = totalItems > 0 ? Math.round((ids.size / totalItems) * 100) : 0;
    await progress.save();

    return withId(progress.toObject() as { _id: string });
  });
}
