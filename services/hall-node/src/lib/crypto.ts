import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.TEMPLATE_ENCRYPTION_KEY;
  if (hex && Buffer.from(hex, "hex").length === 32) {
    return Buffer.from(hex, "hex");
  }
  if (process.env.NODE_ENV !== "production") {
    return crypto.createHash("sha256").update("dev-only-bio-key-change-me").digest();
  }
  throw new Error("TEMPLATE_ENCRYPTION_KEY required on hall node (same as API)");
}

export function decryptTemplate(blob: Buffer): Buffer {
  const key = getKey();
  if (blob.length < IV_LEN + TAG_LEN + 1) throw new Error("invalid ciphertext");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function dataDir(): string {
  const d = process.env.HALL_DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
