"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpCaptureDriver = void 0;
const capture_js_1 = require("./capture.js");
/**
 * Calls a small **local HTTP service** that wraps the real fingerprint SDK (SecuGen, etc.).
 * The browser cannot access USB scanners directly; the bridge runs on the same PC as the reader.
 */
class HttpCaptureDriver {
    vendor;
    #url;
    constructor(opts) {
        const base = opts.baseUrl.replace(/\/$/, "");
        const path = opts.capturePath ?? "/capture";
        this.#url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
        this.vendor = opts.vendor ?? capture_js_1.VENDOR_SECUGEN;
    }
    async capture() {
        const r = await fetch(this.#url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        if (!r.ok) {
            const t = await r.text();
            throw new Error(`Capture bridge ${r.status}: ${t}`);
        }
        const j = (await r.json());
        if (!j.imageBase64 || typeof j.width !== "number" || typeof j.height !== "number") {
            throw new Error("Capture bridge returned invalid payload (need imageBase64, width, height)");
        }
        return j;
    }
}
exports.HttpCaptureDriver = HttpCaptureDriver;
