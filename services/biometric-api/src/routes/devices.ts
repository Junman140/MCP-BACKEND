import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role } from "../models/roles.js";
import { AuditLog, Device } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withIds } from "../lib/serialize.js";

const CreateDevice = z.object({
  name: z.string().min(1),
  hallLabel: z.string().optional(),
});

export async function deviceRoutes(app: FastifyInstance) {
  app.post(
    "/devices",
    {
      onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN])],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const body = CreateDevice.parse(req.body);
      const secret = crypto.randomBytes(32).toString("hex");
      const apiKeyHash = await bcrypt.hash(secret, 12);
      const dev = await Device.create({
        tenantId: tid,
        name: body.name,
        hallLabel: body.hallLabel,
        apiKeyHash,
      });
      await AuditLog.create({
        tenantId: tid,
        actorId: user.sub,
        action: "device.create",
        entityType: "Device",
        entityId: dev._id,
      });
      return {
        id: dev._id,
        name: dev.name,
        hallLabel: dev.hallLabel,
        apiKey: secret,
        message: "Store apiKey securely; it is shown only once.",
      };
    }
  );

  app.delete(
    "/devices/:id",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const id = (req.params as { id: string }).id;
      const d = await Device.findOneAndDelete({ _id: id, tenantId: tid });
      if (!d) return reply.code(404).send({ error: "Device not found" });
      return { ok: true };
    }
  );

  app.get(
    "/devices",
    {
      onRequest: [
        app.authenticate,
        requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.VIEWER]),
      ],
    },
    async (req, reply) => {
      const user = req.user as JwtUser;
      const tid = resolveTenantId(req, reply, user);
      if (!tid) return;
      const rows = await Device.find({ tenantId: tid })
        .select("_id name hallLabel lastSeenAt createdAt")
        .sort({ createdAt: -1 })
        .lean();
      return withIds(rows as { _id: string }[]);
    }
  );
}
