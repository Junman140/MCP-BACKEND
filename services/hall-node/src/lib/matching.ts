const BASE = process.env.MATCHING_SERVICE_URL ?? "http://127.0.0.1:5050";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`matching ${path}: ${res.status} ${t}`);
  }
  return res.json() as Promise<T>;
}

export async function extractTemplate(payload: {
  imageBase64: string;
  width: number;
  height: number;
  dpi: number;
  format: "png" | "raw_gray8";
}) {
  return post<{
    template_base64: string;
    template_version: string;
  }>("/extract", {
    image_base64: payload.imageBase64,
    width: payload.width,
    height: payload.height,
    dpi: payload.dpi,
    format: payload.format,
  });
}

export async function matchTemplates(
  probeB64: string,
  candB64: string,
  threshold?: number
) {
  return post<{ score: number; matched: boolean; threshold: number }>("/match", {
    probe_template_base64: probeB64,
    candidate_template_base64: candB64,
    ...(threshold != null ? { threshold } : {}),
  });
}
