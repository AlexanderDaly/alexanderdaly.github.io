# Project Golem-Harness Architecture

Project Golem-Harness is an internal, consent-based Android automation research harness for operator-owned devices, controlled emulators, and explicitly consenting test users only. Phase 1 builds only the server-side ingestion foundation.

## Data Flow

1. The synthetic mock client, or a future consent-gated Android client, creates a telemetry frame.
2. The client signs the canonical frame payload with an Ed25519 device key.
3. The Go proxy receives the frame over the gRPC ingestion endpoint.
4. The proxy enforces bounded request size, device authorization, detached signature verification, timestamp freshness, and replay checks.
5. Unsanitized frame content exists only in bounded request memory.
6. The sanitizer applies package policy, kill-switch checks, structural attrition, regex redaction, local NER hooks, and vision-redaction hooks.
7. Only accepted sanitized frames can be wrapped as `storage.SanitizedFrame`.
8. The storage sink persists sanitized JSONL frames.

No Android client or driver is included in this nested project yet. The only client-side executable is the synthetic Go mock client.

## Trust Boundaries

- **Transport boundary:** optional mTLS can authenticate client certificates at the gRPC server.
- **Device authorization boundary:** device ids are mapped to configured Ed25519 public keys.
- **Sanitizer boundary:** raw pre-storage text and signatures must be removed before storage.
- **Storage boundary:** storage independently rejects frames without accepted sanitizer metadata or frames that still contain signatures or raw pre-storage fields.

## Telemetry Frame Lifecycle

- **Pre-sanitization:** a frame may contain `raw_text_pre_storage` and `raw_content_description_pre_storage` fields for local sanitizer inspection only.
- **Authentication:** the detached signature is verified against a canonical JSON representation with the signature envelope removed.
- **Sanitization:** raw text-like values are either hashed when they appear safe or represented as redacted status when regex/local detectors identify sensitive content.
- **Post-sanitization:** accepted frames carry sanitizer metadata, redaction rules, fields dropped, and safe UI structure.
- **Persistence:** only post-sanitization accepted frames cross the storage boundary.

## mTLS and Ed25519 Rationale

mTLS protects the transport channel and can bind requests to configured client certificates. Ed25519 signatures authenticate each frame payload independently, making stored or replayed request bodies detectable even if they are observed outside the live connection.

The current foundation maps device id to Ed25519 public key. Certificate-to-device mapping is a planned hardening layer for future mTLS deployments.

## Sanitizer Stages

- Package allowlist: Phase 1 accepts only explicitly configured package names.
- Sensitive package kill switch: known sensitive packages are quarantined before storage.
- Structural attrition: signature envelopes and pre-storage-only raw fields are removed.
- Regex redaction: synthetic emails, phone numbers, SSN-like values, payment-card-like numbers, addresses, bearer/API-token-like strings, and long numeric identifiers are redacted.
- Local NER interface: implemented as an interface with a conservative no-op placeholder. No cloud APIs are called.
- Vision redaction interface: implemented as a screenshot reference and bounding-box interface. No OCR or raw screenshot storage is implemented.

## Storage Boundary

Phase 1 includes a JSONL sink for sanitized test trajectories. Parquet is intentionally deferred until the frame contract and sanitizer behavior settle. The storage API accepts only `storage.SanitizedFrame`, which can only be constructed after validation.

## Phase 1 Limitations

- Protobuf Go bindings are not generated yet; the schema is authoritative, and the current gRPC scaffold uses a JSON codec for testability.
- Storage is JSONL, not Parquet.
- Replay protection is in-memory.
- Local NER and vision redaction are interfaces with conservative placeholders.
- No Android AccessibilityService, UI Automator driver, OCR, model inference, cloud sanitizer, Android client scaffold, or real app automation is included.

Generate protobuf bindings later with:

```powershell
protoc --go_out=server/gen --go_opt=paths=source_relative --go-grpc_out=server/gen --go-grpc_opt=paths=source_relative proto/golem/v1/telemetry.proto
```
