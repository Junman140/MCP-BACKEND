const BASE = process.env.MATCHING_SERVICE_URL ?? "http://127.0.0.1:5050";

export function matchingServiceUrl(): string {
  return BASE;
}

/** True when the matching microservice is not reachable (down / wrong URL). */
export function isMatchingUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|fetch failed|ENOTFOUND|network|timeout|UND_ERR_CONNECT/i.test(msg);
}

export interface ExtractResult {
  template_base64: string;
  template_version: string;
}

export interface MatchResult {
  score: number;
  matched: boolean;
  threshold: number;
}

export interface QualityResult {
  score: number;
  model_version: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`matching service ${path}: ${res.status} ${t}`);
  }
  return res.json() as Promise<T>;
}

export async function extractTemplate(payload: {
  imageBase64: string;
  width: number;
  height: number;
  dpi: number;
  format: "png" | "raw_gray8";
}): Promise<ExtractResult> {
  return post<ExtractResult>("/extract", {
    image_base64: payload.imageBase64,
    width: payload.width,
    height: payload.height,
    dpi: payload.dpi,
    format: payload.format,
  });
}

export async function matchTemplates(
  probeTemplateB64: string,
  candidateTemplateB64: string,
  threshold?: number
): Promise<MatchResult> {
  return post<MatchResult>("/match", {
    probe_template_base64: probeTemplateB64,
    candidate_template_base64: candidateTemplateB64,
    ...(threshold != null ? { threshold } : {}),
  });
}

export async function qualityScore(payload: {
  imageBase64: string;
  width: number;
  height: number;
  format: "png" | "raw_gray8";
}): Promise<QualityResult> {
  return post<QualityResult>("/quality", {
    image_base64: payload.imageBase64,
    width: payload.width,
    height: payload.height,
    format: payload.format,
  });
}
