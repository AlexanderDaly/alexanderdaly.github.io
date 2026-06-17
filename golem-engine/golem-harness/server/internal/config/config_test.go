package config_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/golem-harness/server/internal/config"
	"github.com/golem-harness/server/internal/testutil"
)

func TestMissingRequiredConfigFailsClearly(t *testing.T) {
	path := writeConfig(t, `{}`)

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected config error")
	}
	if !strings.Contains(err.Error(), "grpc_addr") {
		t.Fatalf("expected clear missing grpc_addr error, got %v", err)
	}
}

func TestInvalidKeyMaterialFailsClearly(t *testing.T) {
	path := writeConfig(t, `{
		"grpc_addr": "127.0.0.1:50051",
		"http_addr": "127.0.0.1:8080",
		"allowed_packages": ["com.example.safe"],
		"devices": [{"device_id": "synthetic-device-001", "key_id": "bad", "ed25519_public_key_b64": "not-base64"}],
		"storage": {"jsonl_path": "testdata/out.jsonl"}
	}`)

	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected config error")
	}
	if !strings.Contains(err.Error(), "ed25519_public_key_b64") {
		t.Fatalf("expected invalid key error, got %v", err)
	}
}

func TestAllowedPackageConfigParses(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	path := writeConfig(t, `{
		"grpc_addr": "127.0.0.1:50051",
		"http_addr": "127.0.0.1:8080",
		"allowed_packages": ["com.example.safe"],
		"devices": [{
			"device_id": "synthetic-device-001",
			"key_id": "test-key",
			"ed25519_public_key_b64": "`+base64.StdEncoding.EncodeToString(publicKey)+`"
		}],
		"storage": {"jsonl_path": "testdata/out.jsonl"}
	}`)

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if got, want := cfg.AllowedPackages[0], "com.example.safe"; got != want {
		t.Fatalf("allowed package = %q, want %q", got, want)
	}
	registry, err := cfg.DeviceRegistry()
	if err != nil {
		t.Fatalf("DeviceRegistry returned error: %v", err)
	}
	if _, ok := registry.Lookup(testutil.DeviceID); !ok {
		t.Fatal("registry missing configured device")
	}
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
