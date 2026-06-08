const BASE = process.env.MATCHING_SERVICE_URL ?? "http://127.0.0.1:5050";
async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`matching ${path}: ${res.status} ${t}`);
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
export async function matchTemplates(probeB64, candB64, threshold) {
    return post("/match", {
        probe_template_base64: probeB64,
        candidate_template_base64: candB64,
        ...(threshold != null ? { threshold } : {}),
    });
}
