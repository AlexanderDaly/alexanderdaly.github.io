# Golem-Harness

Golem-Harness is a server-side foundation for an internal, consent-based Android automation research harness. Phase 1 is intentionally limited to safe ingestion plumbing: protobuf schema, Go proxy scaffold, Ed25519 frame verification, fail-closed sanitization, sanitized-only storage, synthetic fixtures, a mock signed client, and tests.

This project is nested under `golem-engine` but remains a separate project boundary. Do not mix generated telemetry output, local keys, certificates, screenshots, or unsanitized test artifacts into source control.

## Layout

- `proto/golem/v1/telemetry.proto`: versioned telemetry contract.
- `server`: Go ingestion proxy, auth, sanitizer, storage, config, and tests.
- `mock-client`: synthetic signed client for local development.
- `docs`: architecture, security, and MVP notes.
- `AGENTS.md`: durable safety and maintenance instructions for future Codex sessions.

## Quick Check

```powershell
cd server
go test ./...
cd ..\mock-client
go test ./...
```

## Boundaries

- Authorized operator-owned devices, controlled emulators, and explicitly consenting test users only.
- No stealth behavior, persistence, anti-detection, credential capture, Android security bypasses, or sensitive-app automation.
- No cloud sanitization, OCR, NER, telemetry processing, screenshot analysis, or model inference.
- Unsanitized telemetry may exist only in bounded in-memory request scope.
- Sanitizer failure must fail closed before storage.
