# CBT Security Infrastructure

## Architecture Overview

The CBT platform implements a defense-in-depth security model with five layers:

```
┌─────────────────────────────────────────┐
│  Layer 5: Device Attestation            │
│  Play Integrity / SafetyNet validation   │
├─────────────────────────────────────────┤
│  Layer 4: App-Level Lockdown            │
│  LockTaskMode + SnitchProtocol V2       │
├─────────────────────────────────────────┤
│  Layer 3: Request Integrity             │
│  HMAC signing + Anti-replay nonces      │
├─────────────────────────────────────────┤
│  Layer 2: Transport Security            │
│  TLS + Certificate Pinning              │
├─────────────────────────────────────────┤
│  Layer 1: Data Encryption               │
│  AES-256-GCM per-exam keys              │
└─────────────────────────────────────────┘
```

## Layer 1: Data Encryption

### Exam Payloads
- **Algorithm**: AES-256-GCM
- **Key Derivation**: Argon2id (Go backend) / HMAC-SHA256 KDF (mobile)
- **Per-Exam Keys**: Each exam gets a unique encryption key derived from `exam_id + master_secret`
- **Omitted Data**: `correct_opt_id` is stripped before student payload generation

### Files
| File | Purpose |
|------|---------|
| `internal/crypto/aes.go` | AES-256-GCM encrypt/decrypt |
| `internal/crypto/keyderive.go` | Argon2id key derivation |
| `internal/packaging/engine.go` | .mcp archive packaging |

## Layer 2: Transport Security

### TLS + Certificate Pinning
- **Android**: `network_security_config.xml` with SHA-256 certificate pins
- **Flutter**: `SecurityService` creates pinning-aware Dio clients
- **iOS**: Certificate pinning via `Info.plist` NSAppTransportSecurity (add separately)

### Security Headers
Every API response includes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000`
- `Cache-Control: no-store`

## Layer 3: Request Integrity

### Anti-Replay
- **Headers**: `X-Timestamp` (unix seconds) + `X-Nonce` (HMAC of timestamp)
- **Validation**: Server rejects requests with clock skew > ±5 minutes or duplicate nonces
- **Files**: `internal/middleware/antireplay.go`

### HMAC Body Signing
- **Header**: `X-Signature` = HMAC-SHA256(request_body, shared_secret)
- **Applied to**: `/exams/:id/submit`, `/exams/:id/upload`, `/telemetry`
- **Files**: `internal/middleware/hmac.go`

### Rate Limiting
- **IP-based token bucket**: 10 req/s burst 20 (general), 3 req/s burst 5 (auth)
- **Files**: `internal/middleware/ratelimit.go`

## Layer 4: App-Level Lockdown

### Android LockTaskMode (Kiosk Mode)
- Uses `DevicePolicyManager` + `DeviceAdminReceiver`
- Prevents: Home button, Back button, Recent apps, Notification shade
- **Files**:
  - `MainActivity.kt` — MethodChannel bridge
  - `CbtDeviceAdminReceiver.kt` — Device admin callbacks
  - `device_admin.xml` — Admin policies
  - `kiosk_service.dart` — Flutter interface

### Snitch Protocol V2
- Monitors `AppLifecycleState` (paused/inactive/hidden → violation)
- Periodic lock-state verification
- Auto-submits after `maxViolationsBeforeAutoSubmit` (default 5) critical violations
- **Files**:
  - `snitch_protocol_v2.dart` — Enhanced protocol with severity levels
  - `snitch_protocol.dart` — Original (kept for backward compat)

## Layer 5: Device Attestation

### Mobile Side
- Retrieves device info: app signature (SHA-256), version, debuggable flag, emulator check
- Sends attestation token to backend at exam start
- **Files**: `device_attestation_service.dart`

### Backend Side
- `/api/v1/device/attest` — Validates device integrity, creates secure session
- Stores per-session encryption salt and session token in MongoDB
- Admin can monitor sessions via `/api/v1/device/sessions`
- **Files**: `internal/handlers/attestation.go`

## Key Storage

### Android
- Encryption keys stored in **Android Keystore** (hardware-backed)
- Accessed via `flutter_secure_storage` (wraps Android Keystore / iOS Keychain)
- **Files**: `security_service.dart`

### Backend
- `JWT_SECRET`, `ENCRYPTION_KEY` via environment variables
- Template encryption keys (biometric system) via 64-char hex env var

## Proctoring

### Face Detection
- Camera: Front-facing, low resolution (saves bandwidth)
- TFLite: BlazeFace model (200KB) for face presence detection
- Violation triggers: no face > 5s, multiple faces detected
- Only uploads violation snapshots (<20KB JPEG)
- **Files**: `proctoring_service_v2.dart`

### Audio Monitoring
- Classifies: silence, ambient noise, human speech, multiple voices
- YAMNet TFLite model for speech/whisper detection
- **Files**: `audio_monitor_service.dart`

### Telemetry
- Real-time heartbeat (every 5s) via HMAC-signed POST
- WebSocket stream for admin dashboard
- **Files**: `telemetry_client.dart` (mobile), `internal/telemetry/hub.go` (backend)

## Deployment Checklist

1. Set `JWT_SECRET` to a strong random value (32+ chars)
2. Set `ENCRYPTION_KEY` to exactly 32 bytes
3. Replace placeholder certificate pins in `network_security_config.xml`
4. Bundle TFLite models in `assets/models/`
5. Set `android:usesCleartextTraffic="false"` in production
6. Disable `FLAG_DEBUGGABLE` for release builds
