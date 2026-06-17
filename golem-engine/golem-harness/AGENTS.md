# AGENTS.md

Future Codex sessions working on Project Golem-Harness must preserve these constraints.

- Always run relevant tests before finishing work. For Go server changes, run `go test ./...` inside `server`.
- Never log or persist raw telemetry, raw XML, screenshots, text values, credentials, signatures, private keys, auth headers, or PII.
- Never use cloud APIs for sanitization, NER, OCR, telemetry processing, screenshots, or model inference.
- Preserve the authorized-use-only scope: operator-owned devices, controlled emulators, and explicitly consenting test users only.
- Prefer fail-closed behavior for auth, sanitization, storage, and config errors.
- Add tests for failure paths whenever adding security-sensitive behavior.
- Document measurable gaps honestly instead of implying placeholder components are complete.
- Keep Phase 1 scoped to safe native/system surfaces and synthetic fixtures.
- Do not implement Android AccessibilityService driver behavior until the server foundation is stable and explicitly requested.
- Do not automate banking apps, password managers, private messaging, email, medical apps, or other sensitive apps in Phase 1.
- Do not add an Android client scaffold until generated protobuf bindings, visible consent UX requirements, and a fresh safety review are in place.
