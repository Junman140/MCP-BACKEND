import type { CaptureDriver, CapturePayload } from "./capture.js";
import { VENDOR_SECUGEN } from "./capture.js";

export interface HttpCaptureDriverOptions {
  /** Base URL of the local capture bridge (e.g. http://127.0.0.1:5055) */
  baseUrl: string;
  /** `vendor` field on returned payloads; defaults to {@link VENDOR_SECUGEN} */
  vendor?: string;
  /** Path under baseUrl; default POST `/capture` */
  capturePath?: string;
}

/**
 * Calls a small **local HTTP service** that wraps the real fingerprint SDK (SecuGen, etc.).
 * The browser cannot access USB scanners directly; the bridge runs on the same PC as the reader.
 */
export class HttpCaptureDriver implements CaptureDriver {
  readonly vendor: string;
  readonly #url: string;

  constructor(opts: HttpCaptureDriverOptions) {
    const base = opts.baseUrl.replace(/\/$/, "");
    const path = opts.capturePath ?? "/capture";
    this.#url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    this.vendor = opts.vendor ?? VENDOR_SECUGEN;
  }

  async capture(): Promise<CapturePayload> {
    const r = await fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Capture bridge ${r.status}: ${t}`);
    }
    const j = (await r.json()) as CapturePayload;
    if (!j.imageBase64 || typeof j.width !== "number" || typeof j.height !== "number") {
      throw new Error("Capture bridge returned invalid payload (need imageBase64, width, height)");
    }
    return j;
  }
}
