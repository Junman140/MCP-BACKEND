import type { FastifyReply, FastifyRequest } from "fastify";
import { Role } from "../models/roles.js";
import type { RoleName } from "../models/roles.js";

export type JwtUser = { sub: string; role: RoleName; tenantId: string | null };

/**
 * Tenant id for data access: tenant users use JWT `tenantId`;
 * SUPER_ADMIN must pass `?tenantId=` (or `tenantId` in JSON body where applicable).
 */
export function resolveTenantId(req: FastifyRequest, reply: FastifyReply, user: JwtUser): string | null {
  if (user.role === Role.SUPER_ADMIN) {
    const q = req.query as { tenantId?: string };
    const body = req.body as { tenantId?: string } | undefined;
    const tid = (q.tenantId ?? body?.tenantId)?.trim();
    if (!tid) {
      reply.code(400).send({
        error:
          "SUPER_ADMIN must specify tenant: add ?tenantId=<id> to the request (use GET /tenants for ids), or log in as a tenant admin user.",
      });
      return null;
    }
    return tid;
  }
  if (!user.tenantId) {
    reply.code(400).send({ error: "Tenant-scoped login required (use a tenant admin account)" });
    return null;
  }
  return user.tenantId;
}
