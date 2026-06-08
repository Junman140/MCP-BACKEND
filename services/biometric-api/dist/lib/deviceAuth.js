import bcrypt from "bcryptjs";
import { Device } from "../models/schemas.js";
export async function authenticateDevice(req, reply) {
    const id = req.headers["x-device-id"];
    const secret = req.headers["x-device-secret"];
    if (!id || !secret) {
        return reply.code(401).send({ error: "Device credentials required" });
    }
    const device = await Device.findOne({ _id: id }).lean();
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
