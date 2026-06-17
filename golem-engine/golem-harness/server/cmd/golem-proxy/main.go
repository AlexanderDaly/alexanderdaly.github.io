package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"github.com/golem-harness/server/internal/auth"
	"github.com/golem-harness/server/internal/config"
	"github.com/golem-harness/server/internal/ingest"
	"github.com/golem-harness/server/internal/sanitize"
	"github.com/golem-harness/server/internal/storage"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func main() {
	configPath := flag.String("config", "testdata/dev-config.example.json", "path to JSON config")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("load config failed", "error", err)
		os.Exit(1)
	}
	registry, err := cfg.DeviceRegistry()
	if err != nil {
		logger.Error("device registry failed", "error", err)
		os.Exit(1)
	}
	sink, err := storage.NewJSONLSink(cfg.Storage.JSONLPath)
	if err != nil {
		logger.Error("storage init failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := sink.Close(); err != nil {
			logger.Error("close storage failed", "error", err)
		}
	}()

	service := ingest.NewServer(
		&auth.Verifier{
			Registry:        registry,
			Replay:          auth.NewReplayCache(),
			MaxAge:          cfg.MaxFrameAge(),
			MaxPayloadBytes: cfg.MaxFrameBytes,
		},
		sanitize.NewPipeline(sanitize.Options{
			AllowedPackages:   cfg.AllowedPackages,
			SensitivePackages: cfg.SensitivePackages,
		}),
		sink,
		logger,
		cfg.MaxFrameBytes,
	)

	var grpcOptions []grpc.ServerOption
	grpcOptions = append(grpcOptions, grpc.MaxRecvMsgSize(cfg.MaxFrameBytes))
	tlsConfig, err := cfg.MTLS.ServerTLSConfig()
	if err != nil {
		logger.Error("mTLS config failed", "error", err)
		os.Exit(1)
	}
	if tlsConfig != nil {
		grpcOptions = append(grpcOptions, grpc.Creds(credentials.NewTLS(tlsConfig)))
	}

	grpcServer := grpc.NewServer(grpcOptions...)
	ingest.RegisterTelemetryIngestServer(grpcServer, service)

	var ready atomic.Bool
	httpServer := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: ingest.HealthMux(ready.Load),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 2)

	listener, err := net.Listen("tcp", cfg.GRPCAddr)
	if err != nil {
		logger.Error("listen gRPC failed", "error", err)
		os.Exit(1)
	}
	ready.Store(true)
	go func() {
		logger.Info("golem proxy gRPC listening", "addr", cfg.GRPCAddr, "mtls", cfg.MTLS.Enabled)
		errCh <- grpcServer.Serve(listener)
	}()
	go func() {
		logger.Info("golem proxy health listening", "addr", cfg.HTTPAddr)
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown requested")
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped", "error", err)
		}
	}

	ready.Store(false)
	grpcServer.GracefulStop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.MaxFrameAge())
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown failed", "error", err)
	}
}
