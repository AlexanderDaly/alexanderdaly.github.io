package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/golem-harness/server/internal/trajectory"
)

const (
	AlgorithmEd25519 = "Ed25519"
	DefaultMaxAge    = 2 * time.Minute
	DefaultMaxFuture = 30 * time.Second
)

var (
	ErrMissingSignature = errors.New("missing signature")
	ErrInvalidSignature = errors.New("invalid signature")
	ErrUnauthorized     = errors.New("unauthorized device")
	ErrExpired          = errors.New("expired frame")
	ErrFutureTimestamp  = errors.New("future frame timestamp")
	ErrReplay           = errors.New("replayed frame")
	ErrOversized        = errors.New("oversized payload")
	ErrMalformed        = errors.New("malformed frame")
)

type DeviceKey struct {
	DeviceID  string
	KeyID     string
	PublicKey ed25519.PublicKey
}

type Registry struct {
	byDevice map[string]DeviceKey
}

func NewRegistry(keys []DeviceKey) (*Registry, error) {
	byDevice := make(map[string]DeviceKey, len(keys))
	for _, key := range keys {
		if key.DeviceID == "" {
			return nil, fmt.Errorf("device key missing device id")
		}
		if len(key.PublicKey) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("device %q has invalid Ed25519 public key length", key.DeviceID)
		}
		if _, exists := byDevice[key.DeviceID]; exists {
			return nil, fmt.Errorf("duplicate device id %q", key.DeviceID)
		}
		copied := make(ed25519.PublicKey, ed25519.PublicKeySize)
		copy(copied, key.PublicKey)
		key.PublicKey = copied
		byDevice[key.DeviceID] = key
	}
	return &Registry{byDevice: byDevice}, nil
}

func ParsePublicKeyBase64(value string) (ed25519.PublicKey, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("decode Ed25519 public key: %w", err)
	}
	if len(decoded) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid Ed25519 public key length: got %d want %d", len(decoded), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(decoded), nil
}

func (r *Registry) Lookup(deviceID string) (DeviceKey, bool) {
	if r == nil {
		return DeviceKey{}, false
	}
	key, ok := r.byDevice[deviceID]
	return key, ok
}

type ReplayCache struct {
	mu      sync.Mutex
	frames  map[string]struct{}
	lastSeq map[string]uint64
}

func NewReplayCache() *ReplayCache {
	return &ReplayCache{
		frames:  make(map[string]struct{}),
		lastSeq: make(map[string]uint64),
	}
}

func (c *ReplayCache) Observe(deviceID, frameID string, sequence uint64) error {
	if c == nil {
		return nil
	}
	if deviceID == "" || frameID == "" {
		return fmt.Errorf("%w: missing device or frame id", ErrMalformed)
	}
	key := deviceID + "\x00" + frameID
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.frames[key]; exists {
		return ErrReplay
	}
	if last, exists := c.lastSeq[deviceID]; exists && sequence <= last {
		return ErrReplay
	}
	c.frames[key] = struct{}{}
	c.lastSeq[deviceID] = sequence
	return nil
}

type Verifier struct {
	Registry        *Registry
	Replay          *ReplayCache
	MaxAge          time.Duration
	MaxFutureSkew   time.Duration
	MaxPayloadBytes int
	Now             func() time.Time
}

func (v *Verifier) VerifyFrame(ctx context.Context, frame trajectory.Frame) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if frame.ProtocolVersion == "" || frame.FrameID == "" || frame.Device.DeviceID == "" {
		return fmt.Errorf("%w: missing required identity fields", ErrMalformed)
	}
	payload, err := trajectory.CanonicalPayload(frame)
	if err != nil {
		return fmt.Errorf("%w: canonical payload: %v", ErrMalformed, err)
	}
	if v.MaxPayloadBytes > 0 && len(payload) > v.MaxPayloadBytes {
		return ErrOversized
	}
	signature := frame.Signature
	if signature == nil || signature.Algorithm == "" || signature.SignatureBase64 == "" {
		return ErrMissingSignature
	}
	if signature.Algorithm != AlgorithmEd25519 {
		return fmt.Errorf("%w: unsupported algorithm", ErrInvalidSignature)
	}
	deviceKey, ok := v.Registry.Lookup(frame.Device.DeviceID)
	if !ok {
		return ErrUnauthorized
	}
	if deviceKey.KeyID != "" && signature.KeyID != "" && signature.KeyID != deviceKey.KeyID {
		return ErrUnauthorized
	}
	rawSignature, err := base64.StdEncoding.DecodeString(signature.SignatureBase64)
	if err != nil || len(rawSignature) != ed25519.SignatureSize {
		return ErrInvalidSignature
	}
	if !ed25519.Verify(deviceKey.PublicKey, payload, rawSignature) {
		return ErrInvalidSignature
	}
	if err := v.verifyTimestamp(frame.EventTimeUnixMillis); err != nil {
		return err
	}
	if err := v.Replay.Observe(frame.Device.DeviceID, frame.FrameID, frame.SequenceNumber); err != nil {
		return err
	}
	return nil
}

func (v *Verifier) verifyTimestamp(unixMillis int64) error {
	if unixMillis <= 0 {
		return fmt.Errorf("%w: missing event timestamp", ErrMalformed)
	}
	now := time.Now
	if v.Now != nil {
		now = v.Now
	}
	maxAge := v.MaxAge
	if maxAge == 0 {
		maxAge = DefaultMaxAge
	}
	maxFuture := v.MaxFutureSkew
	if maxFuture == 0 {
		maxFuture = DefaultMaxFuture
	}
	eventTime := time.UnixMilli(unixMillis)
	current := now()
	if current.Sub(eventTime) > maxAge {
		return ErrExpired
	}
	if eventTime.Sub(current) > maxFuture {
		return ErrFutureTimestamp
	}
	return nil
}
