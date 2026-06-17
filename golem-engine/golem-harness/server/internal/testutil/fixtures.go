package testutil

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/golem-harness/server/internal/trajectory"
)

const (
	DeviceID       = "synthetic-device-001"
	TrajectoryID   = "trajectory-synthetic-001"
	DefaultFrameID = "frame-synthetic-001"
)

func SyntheticFrame(eventTime time.Time, foregroundPackage string) trajectory.Frame {
	return trajectory.Frame{
		ProtocolVersion:     "golem.telemetry.v1",
		TrajectoryID:        TrajectoryID,
		FrameID:             DefaultFrameID,
		SequenceNumber:      1,
		EventTimeUnixMillis: eventTime.UnixMilli(),
		Device: trajectory.DeviceContext{
			DeviceID:             DeviceID,
			AndroidSDKVersion:    35,
			BuildFingerprintHash: trajectory.SHA256Hex("synthetic-build-fingerprint"),
		},
		App: trajectory.AppContext{
			ForegroundPackage:  foregroundPackage,
			ForegroundActivity: "com.example.safe.MainActivity",
		},
		UITree: trajectory.UITreeSnapshot{
			SnapshotID: "snapshot-synthetic-001",
			Nodes: []trajectory.UINode{{
				StableNodeID:      "node-root",
				Bounds:            trajectory.Rect{Left: 0, Top: 0, Right: 1080, Bottom: 1920},
				ClassName:         "android.widget.Button",
				PackageName:       foregroundPackage,
				ResourceID:        trajectory.RedactedValue{Status: trajectory.RedactionStatusHashed, SHA256: trajectory.SHA256Hex("com.example.safe:id/demo")},
				RawTextPreStorage: "Synthetic demo button",
				Clickable:         true,
				Enabled:           true,
			}},
		},
		Intent: trajectory.IntentMetadata{
			IntentID:           "intent-synthetic-001",
			OperatorIntentHash: trajectory.SHA256Hex("tap demo button"),
			TargetPackage:      foregroundPackage,
		},
		Action: trajectory.ActionMetadata{
			ActionID:     "action-synthetic-001",
			ActionType:   "tap",
			TargetNodeID: "node-root",
		},
		UISettle: trajectory.UISettleMetadata{
			RequestedWaitMillis:  250,
			ObservedStableMillis: 300,
			SettleStrategy:       "placeholder",
		},
		Screenshot: trajectory.ScreenshotRef{
			ReferenceID: "screenshot-ref-synthetic-001",
			SHA256:      trajectory.SHA256Hex("synthetic-screenshot-placeholder"),
			Width:       1080,
			Height:      1920,
		},
	}
}

func SanitizedSyntheticFrame(eventTime time.Time, foregroundPackage string) trajectory.Frame {
	frame := SyntheticFrame(eventTime, foregroundPackage)
	frame.UITree.Nodes[0].Text = trajectory.RedactedValue{
		Status: trajectory.RedactionStatusHashed,
		SHA256: trajectory.SHA256Hex(frame.UITree.Nodes[0].RawTextPreStorage),
	}
	frame.UITree.Nodes[0].RawTextPreStorage = ""
	frame.Sanitizer = trajectory.SanitizerMetadata{
		Version:     "local-sanitizer-v0.1.0",
		Decision:    trajectory.DecisionAccept,
		ReasonCodes: []string{"accepted"},
		FieldsDropped: []string{
			"signature",
			"ui_tree.nodes.raw_text_pre_storage",
		},
	}
	frame.AllowlistDecision = trajectory.AllowlistDecision{
		Allowed:       true,
		ReasonCode:    "accepted",
		PolicyVersion: "local-sanitizer-v0.1.0",
	}
	return frame
}

func MustJSON(t *testing.T, value any) string {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(payload)
}
