# Golem Engine

This directory contains nested project work that should remain separate from the public site content around it.

## Projects

- `golem-harness`: server-side foundation for a consent-based Android automation research harness. It contains the protobuf contract, Go ingestion proxy scaffold, sanitizer boundary, storage abstraction, mock signed client, tests, and docs.

## Safety Scope

Golem-Harness is for operator-owned devices, controlled emulators, and explicitly consenting test users only. Do not add stealth behavior, persistence, anti-detection, credential capture, Android security bypasses, cloud sanitization, or automation against third-party accounts/devices without authorization.

This nested directory is a normal source handoff location. It must not be used as a covert transport channel for unsanitized telemetry, secrets, logs, screenshots, or generated output.
