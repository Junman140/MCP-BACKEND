import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RoleName } from "../models/roles.js";
import { LecturerProfile, Course } from "../models/schemas.js";

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

  app.decorate("resolveLecturer", async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as { sub: string; role: RoleName; tenantId: string | null } | undefined;
    if (!user) return reply.code(401).send({ error: "Unauthorized" });

    const profile = await LecturerProfile.findOne({
      userId: user.sub,
      isActive: true,
    }).lean() as Record<string, any> | null;

    if (!profile) {
      return reply.code(403).send({ error: "No active lecturer profile. Contact an administrator." });
    }

    const courses = await Course.find({
      tenantId: user.tenantId,
      lecturerIds: profile._id,
    })
      .select("_id")
      .lean() as { _id: string }[];

    request.lecturer = {
      profileId: profile._id as string,
      userId: user.sub,
      staffId: profile.staffId as string,
      departmentId: (profile.departmentId as string) ?? null,
      courseIds: courses.map((c) => c._id),
    };
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
