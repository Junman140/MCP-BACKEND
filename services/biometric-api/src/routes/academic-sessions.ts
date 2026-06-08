import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { AcademicSession } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { suggestNextAcademicSession } from "../lib/academicSession.js";
import { withId, withIds } from "../lib/serialize.js";

const Body = z.object({ label: z.string().min(1) });
const Patch = Body.partial();

export async function academicSessionRoutes(app: FastifyInstance) {
  app.get(
    "/academic-sessions/suggest-next",
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
      const rows = await AcademicSession.find({ tenantId: tid }).lean();
      const labels = rows.map((r) => r.label);
      const suggested = suggestNextAcademicSession(labels);
      return { suggested, basedOnCount: labels.length };
    }
  );

  app.get(
    "/academic-sessions",
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
      const rows = await AcademicSession.find({ tenantId: tid })
        .sort({ label: -1 })
        .limit(200)
        .lean();
      return withIds(rows as { _id: string }[]);
    }
  );

  app.post(
    "/academic-sessions",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = Body.parse(req.body);
      try {
        const s = await AcademicSession.create({
          tenantId: tid,
          label: body.label.trim(),
        });
        return withId(s.toObject() as { _id: string });
      } catch (e: unknown) {
        if ((e as { code?: number }).code === 11000) {
          return reply.code(409).send({ error: "Session label already exists" });
        }
        throw e;
      }
    }
  );

  app.patch(
    "/academic-sessions/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const body = Patch.parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.label !== undefined) updates.label = body.label.trim();
      const s = await AcademicSession.findOneAndUpdate({ _id: id, tenantId: tid }, { $set: updates }, { new: true }).lean();
      if (!s) return reply.code(404).send({ error: "Not found" });
      return withId(s as { _id: string });
    }
  );

  app.delete(
    "/academic-sessions/:id",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])] },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const r = await AcademicSession.deleteOne({ _id: id, tenantId: tid });
      if (r.deletedCount === 0) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    }
  );
}
