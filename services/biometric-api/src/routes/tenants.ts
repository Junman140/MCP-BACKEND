import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Tenant, User } from "../models/schemas.js";
import { hashPassword } from "../lib/auth.js";
import { requireRole } from "../lib/auth.js";
import { withIds } from "../lib/serialize.js";

const CreateTenant = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

export async function tenantRoutes(app: FastifyInstance) {
  app.post(
    "/tenants",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async (req, reply) => {
      const body = CreateTenant.parse(req.body);
      const exists = await Tenant.findOne({ slug: body.slug }).lean();
      if (exists) return reply.code(409).send({ error: "Slug taken" });
      const pw = await hashPassword(body.adminPassword);
      const tenant = await Tenant.create({
        name: body.name,
        slug: body.slug,
      });
      await User.create({
        tenantId: tenant._id,
        email: body.adminEmail,
        passwordHash: pw,
        role: Role.TENANT_ADMIN,
      });
      return { id: tenant._id, slug: tenant.slug, name: tenant.name };
    }
  );

  app.get(
    "/tenants",
    { onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN])] },
    async () => {
      const rows = await Tenant.find().sort({ name: 1 }).lean();
      return withIds(rows as { _id: string }[]);
    }
  );
}
