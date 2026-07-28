import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { User } from "../models/schemas.js";
import { requireRole, hashPassword } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const CreateBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([Role.ENROLLER, Role.INVIGILATOR, Role.BIOMETRIC_OPERATOR, Role.LECTURER]),
  displayName: z.string().min(1),
});

const UpdateBody = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  displayName: z.string().optional(),
  role: z.enum([Role.ENROLLER, Role.INVIGILATOR, Role.BIOMETRIC_OPERATOR, Role.LECTURER]).optional(),
});

export async function operatorRoutes(app: FastifyInstance) {
  // ── List all operators in this school ──
  app.get("/operators", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const operators = await User.find({
      tenantId: tid,
      role: { $in: [Role.ENROLLER, Role.INVIGILATOR, Role.BIOMETRIC_OPERATOR, Role.LECTURER] },
    }).select("-passwordHash").lean<Record<string, any>[]>();
    return withIds(operators as { _id: string }[]);
  });

  // ── Create operator ──
  app.post("/operators", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = CreateBody.parse(req.body);
    const exists = await User.findOne({ email: body.email });
    if (exists) return reply.code(409).send({ error: "Email already registered" });
    const pwHash = await hashPassword(body.password);
    const op = await User.create({ tenantId: tid, email: body.email, passwordHash: pwHash, role: body.role, displayName: body.displayName });
    return reply.code(201).send(withId(op.toObject() as { _id: string }));
  });

  // ── Update operator ──
  app.patch("/operators/:id", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const id = (req.params as { id: string }).id;
    const body = UpdateBody.parse(req.body);
    const updates: Record<string, unknown> = {};
    if (body.email !== undefined) updates.email = body.email;
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.role !== undefined) updates.role = body.role;
    if (body.password) updates.passwordHash = await hashPassword(body.password);
    const op = await User.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
    if (!op) return reply.code(404).send({ error: "Not found" });
    return withId(op as { _id: string });
  });

  // ── Delete operator ──
  app.delete("/operators/:id", { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const r = await User.deleteOne({ _id: (req.params as { id: string }).id, tenantId: tid });
    if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
