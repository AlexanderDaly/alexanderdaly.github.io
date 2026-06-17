# Security

## Authorized Use Only

Project Golem-Harness is scoped to operator-owned devices, controlled emulators, and explicitly consenting test users. Do not use it for third-party devices, accounts, apps, or services without explicit authorization.

## Non-Goals

- Stealth behavior
- Persistence on devices
- Anti-detection
- Credential capture
- Android security bypasses
- Automation of banking apps, password managers, private messaging, email, medical apps, or other sensitive apps in Phase 1
- Cloud OCR, cloud NER, cloud telemetry processing, or cloud model inference

## Threat Model

The Phase 1 proxy assumes network callers may be unauthorized, payloads may be tampered with, frames may be replayed, timestamps may be stale, and raw UI text may contain sensitive data. The proxy rejects malformed, unsigned, unauthorized, expired, replayed, and oversized frames before storage.

## Sensitive Package Handling

The sanitizer accepts only configured allowlisted packages. Known sensitive packages are quarantined with machine-readable reason codes. Non-allowlisted packages are dropped by default.

## Log Safety

Logs are limited to safe metadata such as device id, trajectory id, frame id, sequence number, foreground package, decisions, and reason codes. Logs must never include raw XML, screenshots, text values, credentials, signatures, private keys, auth headers, or PII.

## Key Handling

Device public keys are configured in JSON config. Private keys are not stored by the proxy. The mock client uses a synthetic development seed only for local testing.

## Sanitizer Failure Behavior

Sanitizer failures fail closed. A failing sanitizer returns a drop decision, and ingestion does not store the frame.

## Known Gaps

- mTLS is wired but local development certificates are not generated automatically.
- Replay protection is process-local memory.
- Certificate-to-device binding is not implemented yet.
- Local NER is a placeholder.
- Vision/OCR redaction is a placeholder and must remain local-only when implemented.
- JSONL storage is temporary; Parquet should be added after schema generation.
- No Android or Kotlin client is included in this nested project yet.

## Local Development Certificates

For local mTLS testing, generate a development CA, server certificate, and client certificate using your preferred local certificate workflow. Keep development private keys outside commits and configure paths in `server/testdata/dev-config.example.json` or a local copy.
