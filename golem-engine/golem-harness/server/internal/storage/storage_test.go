package storage_test

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golem-harness/server/internal/storage"
	"github.com/golem-harness/server/internal/testutil"
	"github.com/golem-harness/server/internal/trajectory"
)

func TestStorageOnlyAcceptsSanitizedFrames(t *testing.T) {
	frame := testutil.SanitizedSyntheticFrame(time.Now(), "com.example.safe")
	sanitized, err := storage.NewSanitizedFrame(frame)
	if err != nil {
		t.Fatalf("NewSanitizedFrame returned error: %v", err)
	}
	sink := storage.NewMemorySink()
	if err := sink.Store(context.Background(), sanitized); err != nil {
		t.Fatalf("Store returned error: %v", err)
	}
	if got := len(sink.Frames()); got != 1 {
		t.Fatalf("stored %d frames, want 1", got)
	}

	unsafe := frame
	unsafe.Signature = &trajectory.SignatureEnvelope{
		Algorithm:       "Ed25519",
		SignatureBase64: base64.StdEncoding.EncodeToString(make([]byte, 64)),
	}
	if _, err := storage.NewSanitizedFrame(unsafe); !errors.Is(err, storage.ErrUnsafeFrame) {
		t.Fatalf("expected unsafe frame error, got %v", err)
	}
}

func TestJSONLSinkDoesNotWriteRawSyntheticPII(t *testing.T) {
	frame := testutil.SanitizedSyntheticFrame(time.Now(), "com.example.safe")
	rawPII := "synthetic-person@example.invalid"
	frame.UITree.Nodes[0].Text = trajectory.RedactedValue{Status: trajectory.RedactionStatusRedacted}
	frame.UITree.Nodes[0].RawTextPreStorage = ""
	sanitized, err := storage.NewSanitizedFrame(frame)
	if err != nil {
		t.Fatalf("NewSanitizedFrame returned error: %v", err)
	}

	path := filepath.Join(t.TempDir(), "frames.jsonl")
	sink, err := storage.NewJSONLSink(path)
	if err != nil {
		t.Fatalf("NewJSONLSink returned error: %v", err)
	}
	if err := sink.Store(context.Background(), sanitized); err != nil {
		t.Fatalf("Store returned error: %v", err)
	}
	if err := sink.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if strings.Contains(string(contents), rawPII) {
		t.Fatal("storage output contains raw synthetic PII")
	}
}

func TestStorageRejectsRawPreStorageFields(t *testing.T) {
	frame := testutil.SanitizedSyntheticFrame(time.Now(), "com.example.safe")
	frame.UITree.Nodes[0].RawTextPreStorage = "synthetic-person@example.invalid"

	if _, err := storage.NewSanitizedFrame(frame); !errors.Is(err, storage.ErrUnsafeFrame) {
		t.Fatalf("expected unsafe frame error, got %v", err)
	}
}
