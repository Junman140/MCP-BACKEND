import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RoleName } from "../models/roles.js";

export async function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, 12);
}

export async function verifyPassword(p: string, hash: string): Promise<boolean> {
  return bcrypt.compare(p, hash);
}

export function registerAuth(app: FastifyInstance) {
  app.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}

export function requireRole(roles: RoleName[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const r = (request.user as { role?: RoleName } | undefined)?.role;
    if (!r || !roles.includes(r)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
  };
}
