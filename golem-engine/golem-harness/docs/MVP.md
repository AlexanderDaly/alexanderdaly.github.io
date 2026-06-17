# MVP

## Implemented

- Versioned protobuf telemetry schema at `proto/golem/v1/telemetry.proto`
- Go gRPC ingestion scaffold with JSON codec adapter
- `/healthz` and `/readyz` HTTP endpoints
- Optional mTLS server configuration
- Ed25519 detached signature verification
- Device id to public key registry
- Expiry, replay, malformed, unauthorized, unsigned, invalid signature, and oversized frame rejection
- Fail-closed sanitizer boundary
- Package allowlist and sensitive-package kill switch
- Regex redaction for synthetic sensitive values
- Local NER and vision redaction interfaces
- Sanitized-only storage interface and JSONL sink
- Synthetic fixtures and tests
- Mock signed client

## Run Tests

From the server module:

```powershell
cd server
go test ./...
```

From the mock client module:

```powershell
cd mock-client
go test ./...
```

## Run the Proxy Locally

```powershell
cd server
go run ./cmd/golem-proxy -config testdata/dev-config.example.json
```

Health endpoints:

```powershell
curl.exe http://127.0.0.1:8080/healthz
curl.exe http://127.0.0.1:8080/readyz
```

## Run the Mock Client

Print the synthetic public key used by the example config:

```powershell
cd mock-client
go run . -print-test-key
```

Send one accepted frame and one sensitive-package frame:

```powershell
cd mock-client
go run . -mode both
```

The accepted frame is stored as sanitized JSONL. The sensitive-package frame is quarantined before storage.

## Before Real Kotlin Driver Work

- Review and stabilize the Go server foundation.
- Generate protobuf Go bindings and replace the JSON codec scaffold.
- Add a fresh Kotlin/Android scaffold only after generated protobuf bindings, visible consent UX requirements, and a safety review are in place.
- Add durable replay tracking.
- Decide on Parquet layout for sanitized trajectories.
- Add local-only NER and vision redaction implementations if needed.
- Add certificate-to-device binding for mTLS deployments.

Only after those foundations are stable should a later task add a visible consent app shell. Do not add `AccessibilityService` behavior without an explicit request and a fresh safety review.
