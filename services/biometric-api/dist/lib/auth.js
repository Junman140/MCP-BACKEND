import bcrypt from "bcryptjs";
export async function hashPassword(p) {
    return bcrypt.hash(p, 12);
}
export async function verifyPassword(p, hash) {
    return bcrypt.compare(p, hash);
}
export function registerAuth(app) {
    app.decorate("authenticate", async function (request, reply) {
        try {
            await request.jwtVerify();
        }
        catch {
            return reply.code(401).send({ error: "Unauthorized" });
        }
    });
}
export function requireRole(roles) {
    return async (request, reply) => {
        const r = request.user?.role;
        if (!r || !roles.includes(r)) {
            return reply.code(403).send({ error: "Forbidden" });
        }
    };
}
