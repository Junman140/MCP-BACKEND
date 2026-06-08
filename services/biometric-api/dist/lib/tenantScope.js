import { Role } from "../models/roles.js";
/**
 * Tenant id for data access: tenant users use JWT `tenantId`;
 * SUPER_ADMIN must pass `?tenantId=` (or `tenantId` in JSON body where applicable).
 */
export function resolveTenantId(req, reply, user) {
    if (user.role === Role.SUPER_ADMIN) {
        const q = req.query;
        const body = req.body;
        const tid = (q.tenantId ?? body?.tenantId)?.trim();
        if (!tid) {
            reply.code(400).send({
                error: "SUPER_ADMIN must specify tenant: add ?tenantId=<id> to the request (use GET /tenants for ids), or log in as a tenant admin user.",
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
