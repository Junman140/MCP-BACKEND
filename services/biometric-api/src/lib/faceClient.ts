const BASE = process.env.FACE_SERVICE_URL ?? "http://127.0.0.1:5056";

export function faceServiceUrl(): string {
  return BASE;
}

export function isFaceUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|fetch failed|ENOTFOUND|network|timeout|UND_ERR_CONNECT/i.test(msg);
}

export interface FaceEmbedding {
  embedding_b64: string;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface FaceExtractResult {
  embeddings: FaceEmbedding[];
  count: number;
  elapsed_ms: number;
}

export async function extractFaceEmbedding(imageBase64: string): Promise<FaceExtractResult> {
  const res = await fetch(`${BASE}/extract-face`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`face service /extract-face: ${res.status} ${t}`);
  }
  return res.json() as Promise<FaceExtractResult>;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error("Embedding dimension mismatch");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function embeddingB64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

export function bufferToFloat32Array(buf: Buffer): Float32Array {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
