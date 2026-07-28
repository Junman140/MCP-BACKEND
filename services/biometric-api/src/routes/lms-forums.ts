import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { DiscussionForum, DiscussionPost } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const ForumBody = z.object({ courseId: z.string().min(1), title: z.string().min(1), description: z.string().optional(), isLocked: z.boolean().optional() });
const PostBody = z.object({ body: z.string().min(1), authorId: z.string().optional(), authorName: z.string().optional(), parentPostId: z.string().optional() });
const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];

export async function lmsForumsRoutes(app: FastifyInstance) {
  app.get("/forums", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const filter: Record<string, unknown> = { tenantId: tid };
    const courseId = (req.query as { courseId?: string }).courseId;
    if (courseId) filter.courseId = courseId;
    const rows = await DiscussionForum.find(filter).sort({ createdAt: -1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/forums", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = ForumBody.parse(req.body);
    const f = await DiscussionForum.create({ ...body, tenantId: tid });
    return withId(f.toObject() as { _id: string });
  });

  app.get("/forums/:id/posts", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const forumId = (req.params as { id: string }).id;
    const rows = await DiscussionPost.find({ tenantId: tid, forumId, parentPostId: null }).sort({ isPinned: -1, createdAt: -1 }).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/forums/:id/posts", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const forumId = (req.params as { id: string }).id;
    const body = PostBody.parse(req.body);
    const p = await DiscussionPost.create({ ...body, tenantId: tid, forumId, authorId: body.authorId ?? user.sub, authorName: body.authorName ?? "User" });
    return withId(p.toObject() as { _id: string });
  });

  app.delete("/posts/:id", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await DiscussionPost.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/posts/:id/pin", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const id = (req.params as { id: string }).id;
    const post = await DiscussionPost.findOne({ _id: id, tenantId: tid });
    if (!post) return reply.code(404).send({ error: "Not found" });
    post.isPinned = !post.isPinned;
    await post.save();
    return withId(post.toObject() as { _id: string });
  });
}
