import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import type { DeviceLean } from "../models/lean.js";
import { Device } from "../models/schemas.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: { id: string; tenantId: string };
  }
}

export async function authenticateDevice(req: FastifyRequest, reply: FastifyReply) {
  const id = req.headers["x-device-id"] as string | undefined;
  const secret = req.headers["x-device-secret"] as string | undefined;
  if (!id || !secret) {
    return reply.code(401).send({ error: "Device credentials required" });
  }
  const device = await Device.findOne({ _id: id }).lean<DeviceLean | null>();
  if (!device) {
    return reply.code(401).send({ error: "Invalid device" });
  }
  const ok = await bcrypt.compare(secret, device.apiKeyHash);
  if (!ok) {
    return reply.code(401).send({ error: "Invalid device" });
  }
  await Device.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } });
  req.device = { id: device._id, tenantId: device.tenantId };
}
