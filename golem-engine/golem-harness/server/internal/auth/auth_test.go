package auth_test

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golem-harness/server/internal/auth"
	"github.com/golem-harness/server/internal/testutil"
	"github.com/golem-harness/server/internal/trajectory"
)

func TestVerifierAcceptsValidSignature(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now, "com.example.safe")
	signFrame(t, &frame, privateKey)

	if err := verifier.VerifyFrame(context.Background(), frame); err != nil {
		t.Fatalf("VerifyFrame returned error: %v", err)
	}
}

func TestVerifierRejectsInvalidSignature(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now, "com.example.safe")
	signFrame(t, &frame, privateKey)
	frame.TrajectoryID = "tampered"

	err := verifier.VerifyFrame(context.Background(), frame)
	if !errors.Is(err, auth.ErrInvalidSignature) {
		t.Fatalf("expected invalid signature, got %v", err)
	}
}

func TestVerifierRejectsMissingSignature(t *testing.T) {
	verifier, _, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now, "com.example.safe")

	err := verifier.VerifyFrame(context.Background(), frame)
	if !errors.Is(err, auth.ErrMissingSignature) {
		t.Fatalf("expected missing signature, got %v", err)
	}
}

func TestVerifierRejectsExpiredTimestamp(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now.Add(-10*time.Minute), "com.example.safe")
	signFrame(t, &frame, privateKey)

	err := verifier.VerifyFrame(context.Background(), frame)
	if !errors.Is(err, auth.ErrExpired) {
		t.Fatalf("expected expired frame, got %v", err)
	}
}

func TestVerifierRejectsReplayedFrameAndSequence(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now, "com.example.safe")
	signFrame(t, &frame, privateKey)

	if err := verifier.VerifyFrame(context.Background(), frame); err != nil {
		t.Fatalf("first VerifyFrame returned error: %v", err)
	}
	if err := verifier.VerifyFrame(context.Background(), frame); !errors.Is(err, auth.ErrReplay) {
		t.Fatalf("expected replayed frame id, got %v", err)
	}

	next := testutil.SyntheticFrame(now, "com.example.safe")
	next.FrameID = "frame-lower-sequence"
	next.SequenceNumber = frame.SequenceNumber
	signFrame(t, &next, privateKey)
	if err := verifier.VerifyFrame(context.Background(), next); !errors.Is(err, auth.ErrReplay) {
		t.Fatalf("expected replayed sequence, got %v", err)
	}
}

func TestVerifierRejectsUnauthorizedDevice(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	frame := testutil.SyntheticFrame(now, "com.example.safe")
	frame.Device.DeviceID = "unknown-device"
	signFrame(t, &frame, privateKey)

	err := verifier.VerifyFrame(context.Background(), frame)
	if !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("expected unauthorized device, got %v", err)
	}
}

func TestVerifierRejectsOversizedPayload(t *testing.T) {
	verifier, privateKey, now := newVerifier(t)
	verifier.MaxPayloadBytes = 256
	frame := testutil.SyntheticFrame(now, "com.example.safe")
	frame.UITree.Nodes[0].RawTextPreStorage = strings.Repeat("synthetic", 100)
	signFrame(t, &frame, privateKey)

	err := verifier.VerifyFrame(context.Background(), frame)
	if !errors.Is(err, auth.ErrOversized) {
		t.Fatalf("expected oversized payload, got %v", err)
	}
}

func newVerifier(t *testing.T) (*auth.Verifier, ed25519.PrivateKey, time.Time) {
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
	now := time.Unix(1_700_000_000, 0).UTC()
	return &auth.Verifier{
		Registry:        registry,
		Replay:          auth.NewReplayCache(),
		MaxAge:          2 * time.Minute,
		MaxPayloadBytes: 64 * 1024,
		Now:             func() time.Time { return now },
	}, privateKey, now
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
