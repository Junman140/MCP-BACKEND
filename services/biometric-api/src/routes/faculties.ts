import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Faculty } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const Body = z.object({ name: z.string().min(1) });
const Patch = Body.partial();

export async function facultyRoutes(app: FastifyInstance) {
  app.get(
    "/faculties",
    {
      onRequest: [
        app.authenticate,
        requireRole([
          Role.SUPER_ADMIN,
          Role.TENANT_ADMIN,
          Role.ENROLLER,
          Role.INVIGILATOR,
          Role.VIEWER,
        ]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const rows = await Faculty.find({ tenantId: tid }).sort({ name: 1 }).limit(500).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/faculties",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = Body.parse(req.body);
      try {
        const f = await Faculty.create({ tenantId: tid, name: body.name.trim() });
        return withId(f.toObject() as { _id: string });
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 11000) {
          return reply.code(409).send({ error: "Faculty name already exists" });
        }
        throw e;
      }
    }
  );

  app.patch(
    "/faculties/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const body = Patch.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      const f = await Faculty.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
      if (!f) return reply.code(404).send({ error: "Not found" });
      return withId(f as { _id: string });
    }
  );

  app.delete(
    "/faculties/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await Faculty.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
