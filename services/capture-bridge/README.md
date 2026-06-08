# Capture bridge (out-of-tree SDK wrapper)

This repo does **not** ship the SecuGen (or other vendor) proprietary SDK. Fingerprint USB readers require a **small local process** on the same PC that:

1. Calls the vendor SDK (DLL / JNI / .NET) to capture a frame.
2. Exposes **HTTP** so Node and the browser can request a capture without bundling native code.

## Contract (implemented by `HttpCaptureDriver` in `@bio/shared`)

- **POST** `{baseUrl}/capture`  
  Body: `{}` (optional JSON; bridge may ignore).

- **Response** `200` JSON — must match `CapturePayload`:

| Field | Type | Required |
|--------|------|----------|
| `vendor` | string | e.g. `secugen` |
| `deviceId` | string | optional |
| `capturedAt` | string | ISO 8601 |
| `width`, `height` | number | pixels |
| `dpi` | number | e.g. `500` |
| `format` | `"png"` \| `"raw_gray8"` | |
| `imageBase64` | string | PNG or raw gray bytes, base64 |

Listen on **localhost** only unless TLS and auth are added.

## SecuGen Hamster Pro (typical Windows path)

1. Install drivers and **SecuGen SDK** from the vendor (e.g. FDx SDK / IDKit per your device generation).
2. Implement `POST /capture` in **C#**, **C++**, or **Java** using their sample code: acquire image → encode as PNG (or raw gray8) → base64 → JSON as above.
3. Run the service on e.g. `http://127.0.0.1:5055`.
4. Point the hall node at it:

```env
CAPTURE_BRIDGE_URL=http://127.0.0.1:5055
```

5. The hall UI **“Capture from device”** calls `POST /api/capture/device`, which forwards to this bridge.

## Admin web (enrollment)

Browsers cannot open arbitrary USB devices. Options:

- Export PNG from the vendor’s enrollment utility and use **file upload** in admin, or
- Run a **desktop** enrollment app that uses the same bridge contract and posts to the API.
