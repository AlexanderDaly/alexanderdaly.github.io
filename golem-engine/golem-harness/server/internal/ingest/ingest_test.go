package ingest_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/golem-harness/server/internal/auth"
	"github.com/golem-harness/server/internal/ingest"
	"github.com/golem-harness/server/internal/sanitize"
	"github.com/golem-harness/server/internal/storage"
	"github.com/golem-harness/server/internal/testutil"
	"github.com/golem-harness/server/internal/trajectory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestIngestStoresOnlyAcceptedSanitizedFrame(t *testing.T) {
	server, privateKey, sink, _ := newIngestServer(t)
	frame := testutil.SyntheticFrame(fixedNow(), "com.example.safe")
	signFrame(t, &frame, privateKey)

	resp, err := server.IngestFrame(context.Background(), &frame)
	if err != nil {
		t.Fatalf("IngestFrame returned error: %v", err)
	}
	if !resp.Accepted {
		t.Fatalf("expected accepted response, got %#v", resp)
	}
	frames := sink.Frames()
	if len(frames) != 1 {
		t.Fatalf("stored %d frames, want 1", len(frames))
	}
	if frames[0].Signature != nil {
		t.Fatal("stored frame contains signature envelope")
	}
	if frames[0].UITree.Nodes[0].RawTextPreStorage != "" {
		t.Fatal("stored frame contains raw pre-storage text")
	}
}

func TestIngestRejectsSensitivePackageBeforeStorage(t *testing.T) {
	server, privateKey, sink, _ := newIngestServer(t)
	frame := testutil.SyntheticFrame(fixedNow(), "com.synthetic.bank")
	signFrame(t, &frame, privateKey)

	resp, err := server.IngestFrame(context.Background(), &frame)
	if err != nil {
		t.Fatalf("IngestFrame returned error: %v", err)
	}
	if resp.Accepted || resp.Decision != trajectory.DecisionQuarantine {
		t.Fatalf("expected quarantined response, got %#v", resp)
	}
	if got := len(sink.Frames()); got != 0 {
		t.Fatalf("stored %d frames, want 0", got)
	}
}

func TestIngestInvalidSignatureIsRejected(t *testing.T) {
	server, privateKey, sink, _ := newIngestServer(t)
	frame := testutil.SyntheticFrame(fixedNow(), "com.example.safe")
	signFrame(t, &frame, privateKey)
	frame.FrameID = "tampered"

	_, err := server.IngestFrame(context.Background(), &frame)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated status, got %v", err)
	}
	if got := len(sink.Frames()); got != 0 {
		t.Fatalf("stored %d frames, want 0", got)
	}
}

func TestIngestSanitizerFailurePreventsStorage(t *testing.T) {
	server, privateKey, sink, _ := newIngestServer(t)
	server.Sanitizer = failingSanitizer{}
	frame := testutil.SyntheticFrame(fixedNow(), "com.example.safe")
	signFrame(t, &frame, privateKey)

	_, err := server.IngestFrame(context.Background(), &frame)
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected internal sanitizer failure, got %v", err)
	}
	if got := len(sink.Frames()); got != 0 {
		t.Fatalf("stored %d frames, want 0", got)
	}
}

func TestLogsDoNotContainRawSyntheticPII(t *testing.T) {
	server, privateKey, _, logs := newIngestServer(t)
	rawPII := "synthetic-person@example.invalid"
	frame := testutil.SyntheticFrame(fixedNow(), "com.example.safe")
	frame.UITree.Nodes[0].RawTextPreStorage = rawPII
	signFrame(t, &frame, privateKey)

	_, err := server.IngestFrame(context.Background(), &frame)
	if err != nil {
		t.Fatalf("IngestFrame returned error: %v", err)
	}
	if strings.Contains(logs.String(), rawPII) {
		t.Fatal("logs contain raw synthetic PII")
	}
}

func newIngestServer(t *testing.T) (*ingest.Server, ed25519.PrivateKey, *storage.MemorySink, *bytes.Buffer) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := auth.NewRegistry([]auth.DeviceKey{{
		DeviceID:  testutil.DeviceID,
		KeyID:     "test-key",
		PublicKey: publicKey,
	}})
	if err != nil {
		t.Fatal(err)
	}
	logs := new(bytes.Buffer)
	logger := slog.New(slog.NewJSONHandler(logs, nil))
	sink := storage.NewMemorySink()
	server := ingest.NewServer(
		&auth.Verifier{
			Registry:        registry,
			Replay:          auth.NewReplayCache(),
			MaxAge:          2 * time.Minute,
			MaxPayloadBytes: 64 * 1024,
			Now:             fixedNow,
		},
		sanitize.NewPipeline(sanitize.Options{AllowedPackages: []string{"com.example.safe"}}),
		sink,
		logger,
		64*1024,
	)
	return server, privateKey, sink, logs
}

func fixedNow() time.Time {
	return time.Unix(1_700_000_000, 0).UTC()
}

func signFrame(t *testing.T, frame *trajectory.Frame, privateKey ed25519.PrivateKey) {
	t.Helper()
	payload, err := trajectory.CanonicalPayload(*frame)
	if err != nil {
		t.Fatal(err)
	}
	frame.Signature = &trajectory.SignatureEnvelope{
		Algorithm:          auth.AlgorithmEd25519,
		KeyID:              "test-key",
		SignatureBase64:    base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload)),
		SignedAtUnixMillis: frame.EventTimeUnixMillis,
	}
}

type failingSanitizer struct{}

func (failingSanitizer) Sanitize(context.Context, trajectory.Frame) (sanitize.Result, error) {
	return sanitize.Result{
		Report: sanitize.Report{
			Decision:         trajectory.DecisionDrop,
			ReasonCodes:      []string{sanitize.ReasonSanitizerFailure},
			SanitizerVersion: sanitize.DefaultVersion,
		},
	}, context.Canceled
}
