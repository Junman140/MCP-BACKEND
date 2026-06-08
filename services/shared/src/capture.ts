/**
 * Vendor-neutral fingerprint capture payload (MVP contract).
 * Implementations: SecuGen SDK bridge, mock for dev, file upload.
 */
/** MVP USB reader family (Hamster Pro, etc.) — string only; no SDK types in app code. */
export const VENDOR_SECUGEN = "secugen";

export type FingerprintImageFormat = "png" | "raw_gray8";

export interface CaptureMetadata {
  vendor: string;
  deviceId?: string;
  capturedAt: string;
  width: number;
  height: number;
  dpi: number;
  format: FingerprintImageFormat;
}

export interface CapturePayload extends CaptureMetadata {
  /** PNG or raw grayscale bytes, base64-encoded */
  imageBase64: string;
}

export interface CaptureDriver {
  readonly vendor: string;
  /** Acquire one image (blocking); used by enrollment station / hall node agent */
  capture(): Promise<CapturePayload>;
}
