import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Department } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const Body = z.object({
  name: z.string().min(1),
  facultyId: z.string().nullable().optional(),
  matricPattern: z.string().optional(),
});
const Patch = Body.partial();

export async function departmentRoutes(app: FastifyInstance) {
  app.get(
    "/departments",
    {
      onRequest: [
        app.authenticate,
        requireRole([
          Role.SUPER_ADMIN,
          Role.TENANT_ADMIN,
          Role.ENROLLER,
          Role.INVIGILATOR,
          Role.BIOMETRIC_OPERATOR,
          Role.VIEWER,
          Role.LECTURER,
        ]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const facultyId = (req.query as { facultyId?: string }).facultyId;
      const filter: Record<string, unknown> = { tenantId: tid };
      if (facultyId === "") filter.facultyId = null;
      else if (facultyId) filter.facultyId = facultyId;
      const rows = await Department.find(filter).sort({ name: 1 }).limit(500).lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/departments",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = Body.parse(req.body);
      try {
        const d = await Department.create({
          tenantId: tid,
          name: body.name.trim(),
          facultyId: body.facultyId ?? null,
          matricPattern: body.matricPattern,
        });
        return withId(d.toObject() as { _id: string });
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 11000) {
          return reply.code(409).send({ error: "Department already exists for this faculty" });
        }
        throw e;
      }
    }
  );

  app.patch(
    "/departments/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const body = Patch.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.facultyId !== undefined) updates.facultyId = body.facultyId;
      if (body.matricPattern !== undefined) updates.matricPattern = body.matricPattern;
      const d = await Department.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
      if (!d) return reply.code(404).send({ error: "Not found" });
      return withId(d as { _id: string });
    }
  );

  app.delete(
    "/departments/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await Department.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
