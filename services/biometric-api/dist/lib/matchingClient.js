const BASE = process.env.MATCHING_SERVICE_URL ?? "http://127.0.0.1:5050";
export function matchingServiceUrl() {
    return BASE;
}
/** True when the matching microservice is not reachable (down / wrong URL). */
export function isMatchingUnreachable(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /ECONNREFUSED|fetch failed|ENOTFOUND|network|timeout|UND_ERR_CONNECT/i.test(msg);
}
async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`matching service ${path}: ${res.status} ${t}`);
    }
    return res.json();
}
export async function extractTemplate(payload) {
    return post("/extract", {
        image_base64: payload.imageBase64,
        width: payload.width,
        height: payload.height,
        dpi: payload.dpi,
        format: payload.format,
    });
}
export async function matchTemplates(probeTemplateB64, candidateTemplateB64, threshold) {
    return post("/match", {
        probe_template_base64: probeTemplateB64,
        candidate_template_base64: candidateTemplateB64,
        ...(threshold != null ? { threshold } : {}),
    });
}
export async function qualityScore(payload) {
    return post("/quality", {
        image_base64: payload.imageBase64,
        width: payload.width,
        height: payload.height,
        format: payload.format,
    });
}
