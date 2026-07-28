import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role } from "../models/roles.js";
import { Message } from "../models/schemas.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import { withId, withIds } from "../lib/serialize.js";

const MsgBody = z.object({ recipientId: z.string().min(1), subject: z.string().optional(), body: z.string().min(1) });
const readRoles = [Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.ENROLLER, Role.LECTURER, Role.VIEWER, Role.INVIGILATOR];

export async function lmsMessagesRoutes(app: FastifyInstance) {
  app.get("/messages", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const rows = await Message.find({ tenantId: tid, $or: [{ senderId: user.sub }, { recipientId: user.sub }] })
      .sort({ createdAt: -1 }).limit(200).lean();
    return withIds(rows as { _id: string }[]);
  });

  app.post("/messages", { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as JwtUser;
    const tid = resolveTenantId(req, reply, user);
    if (!tid) return;
    const body = MsgBody.parse(req.body);
    const m = await Message.create({ ...body, tenantId: tid, senderId: user.sub });
    return withId(m.toObject() as { _id: string });
  });
}
