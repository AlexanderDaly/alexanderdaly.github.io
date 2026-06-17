package config

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golem-harness/server/internal/auth"
)

const (
	DefaultMaxFrameBytes     = 64 * 1024
	DefaultMaxFrameAgeSecond = 120
)

type Config struct {
	GRPCAddr           string         `json:"grpc_addr"`
	HTTPAddr           string         `json:"http_addr"`
	MaxFrameBytes      int            `json:"max_frame_bytes"`
	MaxFrameAgeSeconds int            `json:"max_frame_age_seconds"`
	AllowedPackages    []string       `json:"allowed_packages"`
	SensitivePackages  []string       `json:"sensitive_packages,omitempty"`
	Devices            []DeviceConfig `json:"devices"`
	Storage            StorageConfig  `json:"storage"`
	MTLS               MTLSConfig     `json:"mtls,omitempty"`
}

type DeviceConfig struct {
	DeviceID            string `json:"device_id"`
	KeyID               string `json:"key_id"`
	Ed25519PublicKeyB64 string `json:"ed25519_public_key_b64"`
}

type StorageConfig struct {
	JSONLPath string `json:"jsonl_path"`
}

type MTLSConfig struct {
	Enabled    bool   `json:"enabled"`
	CAFile     string `json:"ca_file,omitempty"`
	CertFile   string `json:"cert_file,omitempty"`
	KeyFile    string `json:"key_file,omitempty"`
	ClientAuth string `json:"client_auth,omitempty"`
}

func Load(path string) (Config, error) {
	if path == "" {
		return Config{}, errors.New("config path is required")
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	cfg.ApplyDefaults()
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c *Config) ApplyDefaults() {
	if c.MaxFrameBytes == 0 {
		c.MaxFrameBytes = DefaultMaxFrameBytes
	}
	if c.MaxFrameAgeSeconds == 0 {
		c.MaxFrameAgeSeconds = DefaultMaxFrameAgeSecond
	}
}

func (c Config) Validate() error {
	if c.GRPCAddr == "" {
		return errors.New("grpc_addr is required")
	}
	if c.HTTPAddr == "" {
		return errors.New("http_addr is required")
	}
	if c.MaxFrameBytes <= 0 {
		return errors.New("max_frame_bytes must be positive")
	}
	if c.MaxFrameAgeSeconds <= 0 {
		return errors.New("max_frame_age_seconds must be positive")
	}
	if len(c.AllowedPackages) == 0 {
		return errors.New("allowed_packages must include at least one package")
	}
	if len(c.Devices) == 0 {
		return errors.New("devices must include at least one device key")
	}
	if c.Storage.JSONLPath == "" {
		return errors.New("storage.jsonl_path is required")
	}
	for i, device := range c.Devices {
		if device.DeviceID == "" {
			return fmt.Errorf("devices[%d].device_id is required", i)
		}
		if device.Ed25519PublicKeyB64 == "" {
			return fmt.Errorf("devices[%d].ed25519_public_key_b64 is required", i)
		}
		if _, err := auth.ParsePublicKeyBase64(device.Ed25519PublicKeyB64); err != nil {
			return fmt.Errorf("devices[%d].ed25519_public_key_b64: %w", i, err)
		}
	}
	if c.MTLS.Enabled {
		if c.MTLS.CAFile == "" || c.MTLS.CertFile == "" || c.MTLS.KeyFile == "" {
			return errors.New("mtls ca_file, cert_file, and key_file are required when mtls is enabled")
		}
	}
	return nil
}

func (c Config) DeviceRegistry() (*auth.Registry, error) {
	keys := make([]auth.DeviceKey, 0, len(c.Devices))
	for _, device := range c.Devices {
		publicKey, err := auth.ParsePublicKeyBase64(device.Ed25519PublicKeyB64)
		if err != nil {
			return nil, err
		}
		keys = append(keys, auth.DeviceKey{
			DeviceID:  device.DeviceID,
			KeyID:     device.KeyID,
			PublicKey: publicKey,
		})
	}
	return auth.NewRegistry(keys)
}

func (c Config) MaxFrameAge() time.Duration {
	return time.Duration(c.MaxFrameAgeSeconds) * time.Second
}

func (m MTLSConfig) ServerTLSConfig() (*tls.Config, error) {
	if !m.Enabled {
		return nil, nil
	}
	cert, err := tls.LoadX509KeyPair(m.CertFile, m.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load server certificate: %w", err)
	}
	caPEM, err := os.ReadFile(m.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read client CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("client CA file did not contain PEM certificates")
	}
	clientAuth := tls.RequireAndVerifyClientCert
	if m.ClientAuth == "verify_if_given" {
		clientAuth = tls.VerifyClientCertIfGiven
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		ClientAuth:   clientAuth,
	}, nil
}
