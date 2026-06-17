package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"

	"github.com/golem-harness/server/internal/auth"
	"github.com/golem-harness/server/internal/sanitize"
	"github.com/golem-harness/server/internal/storage"
	"github.com/golem-harness/server/internal/trajectory"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/status"
)

const FullIngestMethod = "/golem.v1.TelemetryIngest/IngestFrame"

type JSONCodec struct{}

func (JSONCodec) Name() string {
	return "json"
}

func (JSONCodec) Marshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func (JSONCodec) Unmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

func init() {
	encoding.RegisterCodec(JSONCodec{})
}

type TelemetryIngestServer interface {
	IngestFrame(context.Context, *trajectory.Frame) (*trajectory.IngestResponse, error)
}

func RegisterTelemetryIngestServer(registrar grpc.ServiceRegistrar, server TelemetryIngestServer) {
	registrar.RegisterService(&TelemetryIngestServiceDesc, server)
}

var TelemetryIngestServiceDesc = grpc.ServiceDesc{
	ServiceName: "golem.v1.TelemetryIngest",
	HandlerType: (*TelemetryIngestServer)(nil),
	Methods: []grpc.MethodDesc{{
		MethodName: "IngestFrame",
		Handler:    ingestFrameHandler,
	}},
	Streams:  []grpc.StreamDesc{},
	Metadata: "proto/golem/v1/telemetry.proto",
}

func ingestFrameHandler(server any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	in := new(trajectory.Frame)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return server.(TelemetryIngestServer).IngestFrame(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     server,
		FullMethod: FullIngestMethod,
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return server.(TelemetryIngestServer).IngestFrame(ctx, req.(*trajectory.Frame))
	}
	return interceptor(ctx, in, info, handler)
}

type Server struct {
	Verifier      *auth.Verifier
	Sanitizer     sanitize.Sanitizer
	Storage       storage.Sink
	Logger        *slog.Logger
	MaxFrameBytes int
}

func NewServer(verifier *auth.Verifier, sanitizer sanitize.Sanitizer, sink storage.Sink, logger *slog.Logger, maxFrameBytes int) *Server {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	return &Server{
		Verifier:      verifier,
		Sanitizer:     sanitizer,
		Storage:       sink,
		Logger:        logger,
		MaxFrameBytes: maxFrameBytes,
	}
}

func (s *Server) IngestFrame(ctx context.Context, frame *trajectory.Frame) (*trajectory.IngestResponse, error) {
	if frame == nil {
		return nil, status.Error(codes.InvalidArgument, "frame is required")
	}
	if err := s.checkSize(*frame); err != nil {
		s.logReject(*frame, []string{"oversized_payload"})
		return nil, status.Error(codes.ResourceExhausted, "frame exceeds configured size limit")
	}
	if s.Verifier == nil {
		return nil, status.Error(codes.FailedPrecondition, "verifier is not configured")
	}
	if err := s.Verifier.VerifyFrame(ctx, *frame); err != nil {
		s.logReject(*frame, []string{safeAuthReason(err)})
		return nil, status.Error(codeForAuthError(err), safeAuthReason(err))
	}
	if s.Sanitizer == nil {
		return nil, status.Error(codes.FailedPrecondition, "sanitizer is not configured")
	}
	result, err := s.Sanitizer.Sanitize(ctx, *frame)
	if err != nil {
		s.logReject(result.Frame, []string{sanitize.ReasonSanitizerFailure})
		return &trajectory.IngestResponse{
			Accepted:    false,
			Decision:    trajectory.DecisionDrop,
			ReasonCodes: []string{sanitize.ReasonSanitizerFailure},
			Message:     "sanitizer failed closed",
		}, status.Error(codes.Internal, "sanitizer failed closed")
	}
	if result.Report.Decision != trajectory.DecisionAccept {
		s.logReject(result.Frame, result.Report.ReasonCodes)
		return &trajectory.IngestResponse{
			Accepted:    false,
			Decision:    result.Report.Decision,
			ReasonCodes: append([]string(nil), result.Report.ReasonCodes...),
			Message:     "frame rejected before storage",
		}, nil
	}
	if s.Storage == nil {
		return nil, status.Error(codes.FailedPrecondition, "storage is not configured")
	}
	sanitizedFrame, err := storage.NewSanitizedFrame(result.Frame)
	if err != nil {
		s.logReject(result.Frame, []string{"storage_boundary_rejected"})
		return nil, status.Error(codes.Internal, "storage boundary rejected frame")
	}
	if err := s.Storage.Store(ctx, sanitizedFrame); err != nil {
		return nil, status.Error(codes.Internal, "store sanitized frame")
	}
	s.logAccept(result.Frame)
	return &trajectory.IngestResponse{
		Accepted:    true,
		Decision:    trajectory.DecisionAccept,
		ReasonCodes: append([]string(nil), result.Report.ReasonCodes...),
		Message:     "stored sanitized frame",
	}, nil
}

func (s *Server) checkSize(frame trajectory.Frame) error {
	if s.MaxFrameBytes <= 0 {
		return nil
	}
	payload, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(payload) > s.MaxFrameBytes {
		return auth.ErrOversized
	}
	return nil
}

func (s *Server) logAccept(frame trajectory.Frame) {
	s.Logger.Info("telemetry frame accepted",
		"device_id", frame.Device.DeviceID,
		"trajectory_id", frame.TrajectoryID,
		"frame_id", frame.FrameID,
		"sequence_number", frame.SequenceNumber,
		"foreground_package", frame.App.ForegroundPackage,
		"decision", frame.Sanitizer.Decision,
	)
}

func (s *Server) logReject(frame trajectory.Frame, reasons []string) {
	s.Logger.Info("telemetry frame rejected",
		"device_id", frame.Device.DeviceID,
		"trajectory_id", frame.TrajectoryID,
		"frame_id", frame.FrameID,
		"sequence_number", frame.SequenceNumber,
		"foreground_package", frame.App.ForegroundPackage,
		"reason_codes", reasons,
	)
}

func safeAuthReason(err error) string {
	switch {
	case errors.Is(err, auth.ErrMissingSignature):
		return "missing_signature"
	case errors.Is(err, auth.ErrInvalidSignature):
		return "invalid_signature"
	case errors.Is(err, auth.ErrUnauthorized):
		return "unauthorized_device"
	case errors.Is(err, auth.ErrExpired):
		return "expired_frame"
	case errors.Is(err, auth.ErrFutureTimestamp):
		return "future_frame_timestamp"
	case errors.Is(err, auth.ErrReplay):
		return "replayed_frame"
	case errors.Is(err, auth.ErrOversized):
		return "oversized_payload"
	case errors.Is(err, auth.ErrMalformed):
		return "malformed_frame"
	default:
		return "auth_failed"
	}
}

func codeForAuthError(err error) codes.Code {
	switch {
	case errors.Is(err, auth.ErrMissingSignature), errors.Is(err, auth.ErrInvalidSignature):
		return codes.Unauthenticated
	case errors.Is(err, auth.ErrUnauthorized):
		return codes.PermissionDenied
	case errors.Is(err, auth.ErrExpired), errors.Is(err, auth.ErrFutureTimestamp):
		return codes.DeadlineExceeded
	case errors.Is(err, auth.ErrReplay):
		return codes.AlreadyExists
	case errors.Is(err, auth.ErrOversized):
		return codes.ResourceExhausted
	case errors.Is(err, auth.ErrMalformed):
		return codes.InvalidArgument
	default:
		return codes.Unauthenticated
	}
}

func HealthMux(ready func() bool) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if ready == nil || !ready() {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready\n"))
	})
	return mux
}
