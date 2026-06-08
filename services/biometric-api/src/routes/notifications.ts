import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Notification } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.get(
    "/notifications",
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

      const query = req.query as { unreadOnly?: string };
      const filter: Record<string, any> = { 
        tenantId: tid,
        $or: [
          { recipientId: user.sub },
          { recipientId: null } // System-wide for the tenant
        ]
      };
      
      if (query.unreadOnly === "true") {
        filter.isRead = false;
      }

      const rows = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      
      return withIds(rows as { _id: string }[]);
    }
  );

  app.get(
    "/notifications/unread-count",
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

      const count = await Notification.countDocuments({
        tenantId: tid,
        $or: [
          { recipientId: user.sub },
          { recipientId: null }
        ],
        isRead: false,
      });

      return { count };
    }
  );

  app.post(
    "/notifications/:id/read",
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
      const n = await Notification.findOneAndUpdate(
        { _id: id, tenantId: tid },
        { $set: { isRead: true } },
        { new: true }
      );

      if (!n) return reply.code(404).send({ error: "Notification not found" });
      return { ok: true };
    }
  );

  app.post(
    "/notifications/read-all",
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

      await Notification.updateMany(
        { 
          tenantId: tid, 
          $or: [{ recipientId: user.sub }, { recipientId: null }],
          isRead: false 
        },
        { $set: { isRead: true } }
      );

      return { ok: true };
    }
  );
}
