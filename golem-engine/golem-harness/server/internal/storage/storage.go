package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/golem-harness/server/internal/trajectory"
)

var ErrUnsafeFrame = errors.New("unsafe frame rejected by storage boundary")

type SanitizedFrame struct {
	frame trajectory.Frame
}

func NewSanitizedFrame(frame trajectory.Frame) (SanitizedFrame, error) {
	if err := ValidateSanitized(frame); err != nil {
		return SanitizedFrame{}, err
	}
	return SanitizedFrame{frame: frame}, nil
}

func (f SanitizedFrame) Frame() trajectory.Frame {
	clone, err := trajectory.CloneFrame(f.frame)
	if err != nil {
		return f.frame
	}
	return clone
}

type Sink interface {
	Store(context.Context, SanitizedFrame) error
}

func ValidateSanitized(frame trajectory.Frame) error {
	if frame.Sanitizer.Version == "" {
		return fmt.Errorf("%w: missing sanitizer version", ErrUnsafeFrame)
	}
	if frame.Sanitizer.Decision != trajectory.DecisionAccept {
		return fmt.Errorf("%w: sanitizer decision %q is not storable", ErrUnsafeFrame, frame.Sanitizer.Decision)
	}
	if frame.Signature != nil {
		return fmt.Errorf("%w: signature envelope must not cross storage boundary", ErrUnsafeFrame)
	}
	for i := range frame.UITree.Nodes {
		if err := validateNode(frame.UITree.Nodes[i], fmt.Sprintf("ui_tree.nodes[%d]", i)); err != nil {
			return err
		}
	}
	return nil
}

func validateNode(node trajectory.UINode, path string) error {
	if node.RawTextPreStorage != "" {
		return fmt.Errorf("%w: %s.raw_text_pre_storage present", ErrUnsafeFrame, path)
	}
	if node.RawContentDescriptionPreStorage != "" {
		return fmt.Errorf("%w: %s.raw_content_description_pre_storage present", ErrUnsafeFrame, path)
	}
	for i := range node.Children {
		if err := validateNode(node.Children[i], fmt.Sprintf("%s.children[%d]", path, i)); err != nil {
			return err
		}
	}
	return nil
}

type MemorySink struct {
	mu     sync.Mutex
	frames []trajectory.Frame
}

func NewMemorySink() *MemorySink {
	return &MemorySink{}
}

func (s *MemorySink) Store(ctx context.Context, frame SanitizedFrame) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frames = append(s.frames, frame.Frame())
	return nil
}

func (s *MemorySink) Frames() []trajectory.Frame {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]trajectory.Frame, 0, len(s.frames))
	for _, frame := range s.frames {
		clone, err := trajectory.CloneFrame(frame)
		if err != nil {
			out = append(out, frame)
			continue
		}
		out = append(out, clone)
	}
	return out
}

type JSONLSink struct {
	mu   sync.Mutex
	file *os.File
	enc  *json.Encoder
}

func NewJSONLSink(path string) (*JSONLSink, error) {
	if path == "" {
		return nil, errors.New("jsonl storage path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &JSONLSink{file: file, enc: json.NewEncoder(file)}, nil
}

func (s *JSONLSink) Store(ctx context.Context, frame SanitizedFrame) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enc.Encode(frame.Frame())
}

func (s *JSONLSink) Close() error {
	if s == nil || s.file == nil {
		return nil
	}
	return s.file.Close()
}
