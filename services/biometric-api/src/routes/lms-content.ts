import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { CourseModule, ContentItem } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const ModuleBody = z.object({ title: z.string().min(1), description: z.string().optional(), order: z.number().optional() });
const ItemBody = z.object({
  title: z.string().min(1),
  type: z.enum(["text","video","pdf","link","quiz-ref","assignment-ref"]),
  body: z.string().optional(),
  url: z.string().optional(),
  mediaType: z.string().optional(),
  duration: z.number().optional(),
  fileSize: z.number().optional(),
  order: z.number().optional(),
  isPublished: z.boolean().optional(),
});

export async function lmsContentRoutes(app: FastifyInstance) {
  // ── Modules ──
  app.get(
    "/courses/:id/modules",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const courseId = (req.params as { id: string }).id;
      const rows = await CourseModule.find({ tenantId: tid, courseId }).sort({ order: 1 }).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/courses/:id/modules",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const courseId = (req.params as { id: string }).id;
      const body = ModuleBody.parse(req.body);
      const m = await CourseModule.create({ tenantId: tid, courseId, title: body.title.trim(), description: body.description, order: body.order ?? 0 });
      return withId(m.toObject() as { _id: string });
    }
  );

  app.delete(
    "/modules/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await CourseModule.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      await ContentItem.deleteMany({ moduleId: id, tenantId: tid });
      return { ok: true };
    }
  );

  // ── Items ──
  app.get(
    "/modules/:id/items",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const moduleId = (req.params as { id: string }).id;
      const rows = await ContentItem.find({ tenantId: tid, moduleId }).sort({ order: 1 }).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/modules/:id/items",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const moduleId = (req.params as { id: string }).id;
      const body = ItemBody.parse(req.body);
      const item = await ContentItem.create({ ...body, moduleId, tenantId: tid, order: body.order ?? 0 });
      return withId(item.toObject() as { _id: string });
    }
  );

  app.delete(
    "/items/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await ContentItem.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
