package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/golem-harness/server/internal/auth"
	"github.com/golem-harness/server/internal/ingest"
	"github.com/golem-harness/server/internal/testutil"
	"github.com/golem-harness/server/internal/trajectory"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	defaultSeedB64 = "adKkDjguppZZ3uSBjgeL8g2KxvC89ajTO3/I8JcEWAM="
	defaultDevice  = testutil.DeviceID
	defaultKeyID   = "synthetic-dev-key-001"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:50051", "gRPC proxy address")
	mode := flag.String("mode", "both", "allowed, sensitive, or both")
	seedB64 := flag.String("seed-base64", defaultSeedB64, "base64 Ed25519 private seed for synthetic test device")
	deviceID := flag.String("device-id", defaultDevice, "synthetic device id")
	keyID := flag.String("key-id", defaultKeyID, "synthetic key id")
	printTestKey := flag.Bool("print-test-key", false, "print the matching public key for config and exit")
	flag.Parse()

	privateKey, publicKey, err := keyFromSeed(*seedB64)
	if err != nil {
		log.Fatalf("load synthetic key: %v", err)
	}
	if *printTestKey {
		fmt.Printf("device_id=%s\n", *deviceID)
		fmt.Printf("key_id=%s\n", *keyID)
		fmt.Printf("ed25519_public_key_b64=%s\n", base64.StdEncoding.EncodeToString(publicKey))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(
		ctx,
		*addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.ForceCodec(ingest.JSONCodec{})),
		grpc.WithBlock(),
	)
	if err != nil {
		log.Fatalf("connect to proxy: %v", err)
	}
	defer conn.Close()

	now := time.Now().UTC()
	switch *mode {
	case "allowed":
		send(ctx, conn, privateKey, *deviceID, *keyID, makeFrame(now, "com.example.safe", "mock-allowed-001", 1))
	case "sensitive":
		send(ctx, conn, privateKey, *deviceID, *keyID, makeFrame(now, "com.synthetic.bank", "mock-sensitive-001", 2))
	case "both":
		send(ctx, conn, privateKey, *deviceID, *keyID, makeFrame(now, "com.example.safe", "mock-allowed-001", 1))
		send(ctx, conn, privateKey, *deviceID, *keyID, makeFrame(now, "com.synthetic.bank", "mock-sensitive-001", 2))
	default:
		log.Fatalf("unknown mode %q", *mode)
	}
}

func keyFromSeed(seedB64 string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	seed, err := base64.StdEncoding.DecodeString(seedB64)
	if err != nil {
		return nil, nil, err
	}
	if len(seed) != ed25519.SeedSize {
		return nil, nil, fmt.Errorf("seed length %d, want %d", len(seed), ed25519.SeedSize)
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	return privateKey, publicKey, nil
}

func makeFrame(now time.Time, pkg, frameID string, sequence uint64) trajectory.Frame {
	frame := testutil.SyntheticFrame(now, pkg)
	frame.FrameID = frameID
	frame.SequenceNumber = sequence
	frame.TrajectoryID = "mock-trajectory-001"
	frame.App.ForegroundActivity = pkg + ".SyntheticActivity"
	return frame
}

func send(ctx context.Context, conn *grpc.ClientConn, privateKey ed25519.PrivateKey, deviceID, keyID string, frame trajectory.Frame) {
	frame.Device.DeviceID = deviceID
	sign(&frame, privateKey, keyID)
	var resp trajectory.IngestResponse
	err := conn.Invoke(ctx, ingest.FullIngestMethod, &frame, &resp)
	if err != nil {
		log.Printf("frame_id=%s package=%s rejected by transport: %v", frame.FrameID, frame.App.ForegroundPackage, err)
		return
	}
	log.Printf("frame_id=%s package=%s accepted=%t decision=%s reasons=%v", frame.FrameID, frame.App.ForegroundPackage, resp.Accepted, resp.Decision, resp.ReasonCodes)
}

func sign(frame *trajectory.Frame, privateKey ed25519.PrivateKey, keyID string) {
	payload, err := trajectory.CanonicalPayload(*frame)
	if err != nil {
		panic(err)
	}
	frame.Signature = &trajectory.SignatureEnvelope{
		Algorithm:          auth.AlgorithmEd25519,
		KeyID:              keyID,
		SignatureBase64:    base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload)),
		SignedAtUnixMillis: frame.EventTimeUnixMillis,
	}
}
