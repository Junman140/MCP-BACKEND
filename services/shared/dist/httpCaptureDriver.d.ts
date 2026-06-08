import type { CaptureDriver, CapturePayload } from "./capture.js";
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
export declare class HttpCaptureDriver implements CaptureDriver {
    #private;
    readonly vendor: string;
    constructor(opts: HttpCaptureDriverOptions);
    capture(): Promise<CapturePayload>;
}
