import type { FastifyInstance } from "fastify";
import { Role } from "../models/roles.js";
import { requireRole } from "../lib/auth.js";
import { resolveTenantId, type JwtUser } from "../lib/tenantScope.js";
import crypto from "node:crypto";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "minio:9000";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "lms-content";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin";
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || `http://localhost:9000/${MINIO_BUCKET}`;

// Simple presigned URL generator for MinIO (S3-compatible)
function sign(key: string, msg: string): Buffer {
  return crypto.createHmac("sha256", key).update(msg).digest();
}

function getSignatureKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = sign(`AWS4${secretKey}`, date);
  const kRegion = sign(kDate as unknown as string, region);
  const kService = sign(kRegion as unknown as string, service);
  return sign(kService as unknown as string, "aws4_request");
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function generateUploadUrl(objectKey: string, contentType: string, expirySeconds = 3600): string {
  const region = "us-east-1";
  const service = "s3";
  const host = MINIO_ENDPOINT;
  const bucket = MINIO_BUCKET;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${MINIO_ACCESS_KEY}/${dateStamp}/${region}/${service}/aws4_request`;
  const expires = expirySeconds;

  const policy = JSON.stringify({
    expiration: new Date(Date.now() + expirySeconds * 1000).toISOString(),
    conditions: [
      { bucket },
      { key: objectKey },
      { "Content-Type": contentType },
      ["content-length-range", 1, 104857600], // 100MB max
    ],
  });

  const policyB64 = Buffer.from(policy).toString("base64");
  const signingKey = getSignatureKey(MINIO_SECRET_KEY, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(policyB64).digest("hex");

  return `http://${host}/${bucket}/${objectKey}?Content-Type=${encodeURIComponent(contentType)}&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credential)}&X-Amz-Date=${amzDate}&X-Amz-Expires=${expires}&X-Amz-Signature=${signature}`;
}

export async function contentUploadRoutes(app: FastifyInstance) {
  // Generate presigned upload URL — client uploads directly to MinIO
  app.post("/content/upload-url", {
    onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])],
  }, async (req, reply) => {
    const body = req.body as { fileName?: string; contentType?: string };
    const fileName = body.fileName || `upload-${Date.now()}`;
    const contentType = body.contentType || "application/octet-stream";

    // Organize by tenant
    const user = req.user as JwtUser;
    const prefix = `${user.tenantId || "global"}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const uploadUrl = generateUploadUrl(prefix, contentType);
    const fileUrl = `http://${MINIO_ENDPOINT}/${MINIO_BUCKET}/${prefix}`;

    return { uploadUrl, fileUrl, objectKey: prefix, bucket: MINIO_BUCKET };
  });

  // Simple server-side upload endpoint (proxy to MinIO via HTTP)
  app.post("/content/upload", {
    onRequest: [app.authenticate, requireRole([Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.LECTURER])],
  }, async (req, reply) => {
    // Accept base64 file data
    const body = req.body as { data?: string; fileName?: string; contentType?: string };
    if (!body.data) return reply.code(400).send({ error: "No file data provided" });

    const user = req.user as JwtUser;
    const prefix = `${user.tenantId || "global"}/${Date.now()}-${(body.fileName || "upload").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const contentType = body.contentType || "application/octet-stream";

    const buffer = Buffer.from(body.data, "base64");
    const uploadUrl = generateUploadUrl(prefix, contentType, 300);

    // Upload to MinIO
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: buffer,
      });
      if (!res.ok) throw new Error(`MinIO upload failed: ${res.status}`);
    } catch (e: any) {
      app.log.error({ err: e, msg: "MinIO upload failed" });
      return { url: uploadUrl.split("?")[0], note: "Upload may have failed — use the returned URL to verify" };
    }

    const fileUrl = `${MINIO_PUBLIC_URL}/${prefix}`;
    return { url: fileUrl, objectKey: prefix, size: buffer.length, contentType };
  });
}
