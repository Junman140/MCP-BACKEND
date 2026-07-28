import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    resolveLecturer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    lecturer?: {
      profileId: string;
      userId: string;
      staffId: string;
      departmentId: string | null;
      courseIds: string[];
    };
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string; tenantId: string | null };
  }
}
