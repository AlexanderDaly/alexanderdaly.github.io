package trajectory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

type RedactionStatus string

const (
	RedactionStatusNone        RedactionStatus = "none"
	RedactionStatusHashed      RedactionStatus = "hashed"
	RedactionStatusRedacted    RedactionStatus = "redacted"
	RedactionStatusDropped     RedactionStatus = "dropped"
	RedactionStatusUnspecified RedactionStatus = ""
)

type SanitizerDecision string

const (
	DecisionAccept     SanitizerDecision = "accept"
	DecisionDrop       SanitizerDecision = "drop"
	DecisionQuarantine SanitizerDecision = "quarantine"
)

type Frame struct {
	ProtocolVersion     string             `json:"protocol_version"`
	TrajectoryID        string             `json:"trajectory_id"`
	FrameID             string             `json:"frame_id"`
	SequenceNumber      uint64             `json:"sequence_number"`
	EventTimeUnixMillis int64              `json:"event_time_unix_millis"`
	Device              DeviceContext      `json:"device"`
	App                 AppContext         `json:"app"`
	AllowlistDecision   AllowlistDecision  `json:"allowlist_decision,omitempty"`
	UITree              UITreeSnapshot     `json:"ui_tree,omitempty"`
	Intent              IntentMetadata     `json:"intent,omitempty"`
	Action              ActionMetadata     `json:"action,omitempty"`
	UISettle            UISettleMetadata   `json:"ui_settle,omitempty"`
	Screenshot          ScreenshotRef      `json:"screenshot,omitempty"`
	Sanitizer           SanitizerMetadata  `json:"sanitizer,omitempty"`
	Signature           *SignatureEnvelope `json:"signature,omitempty"`
}

type DeviceContext struct {
	DeviceID              string `json:"device_id"`
	AndroidSDKVersion     int32  `json:"android_sdk_version"`
	BuildFingerprintHash  string `json:"build_fingerprint_hash,omitempty"`
	RedactedBuildMetadata string `json:"redacted_build_metadata,omitempty"`
}

type AppContext struct {
	ForegroundPackage  string `json:"foreground_package"`
	ForegroundActivity string `json:"foreground_activity,omitempty"`
}

type AllowlistDecision struct {
	Allowed             bool   `json:"allowed"`
	KillSwitchTriggered bool   `json:"kill_switch_triggered"`
	ReasonCode          string `json:"reason_code,omitempty"`
	PolicyVersion       string `json:"policy_version,omitempty"`
}

type UITreeSnapshot struct {
	SnapshotID string   `json:"snapshot_id,omitempty"`
	Nodes      []UINode `json:"nodes,omitempty"`
}

type UINode struct {
	StableNodeID                    string        `json:"stable_node_id,omitempty"`
	Bounds                          Rect          `json:"bounds,omitempty"`
	ClassName                       string        `json:"class_name,omitempty"`
	PackageName                     string        `json:"package_name,omitempty"`
	ResourceID                      RedactedValue `json:"resource_id,omitempty"`
	Text                            RedactedValue `json:"text,omitempty"`
	ContentDescription              RedactedValue `json:"content_description,omitempty"`
	Clickable                       bool          `json:"clickable,omitempty"`
	Enabled                         bool          `json:"enabled,omitempty"`
	Focused                         bool          `json:"focused,omitempty"`
	Selected                        bool          `json:"selected,omitempty"`
	Checkable                       bool          `json:"checkable,omitempty"`
	Children                        []UINode      `json:"children,omitempty"`
	RawTextPreStorage               string        `json:"raw_text_pre_storage,omitempty"`
	RawContentDescriptionPreStorage string        `json:"raw_content_description_pre_storage,omitempty"`
}

type Rect struct {
	Left   int32 `json:"left,omitempty"`
	Top    int32 `json:"top,omitempty"`
	Right  int32 `json:"right,omitempty"`
	Bottom int32 `json:"bottom,omitempty"`
}

type RedactedValue struct {
	Status RedactionStatus `json:"status,omitempty"`
	SHA256 string          `json:"sha256,omitempty"`
}

type IntentMetadata struct {
	IntentID           string `json:"intent_id,omitempty"`
	OperatorIntentHash string `json:"operator_intent_hash,omitempty"`
	TargetPackage      string `json:"target_package,omitempty"`
	TargetActivity     string `json:"target_activity,omitempty"`
}

type ActionMetadata struct {
	ActionID      string `json:"action_id,omitempty"`
	ActionType    string `json:"action_type,omitempty"`
	TargetNodeID  string `json:"target_node_id,omitempty"`
	ArgumentsHash string `json:"arguments_hash,omitempty"`
}

type UISettleMetadata struct {
	RequestedWaitMillis  int32  `json:"requested_wait_millis,omitempty"`
	ObservedStableMillis int32  `json:"observed_stable_millis,omitempty"`
	SettleStrategy       string `json:"settle_strategy,omitempty"`
}

type ScreenshotRef struct {
	ReferenceID    string         `json:"reference_id,omitempty"`
	SHA256         string         `json:"sha256,omitempty"`
	Width          int32          `json:"width,omitempty"`
	Height         int32          `json:"height,omitempty"`
	RedactionBoxes []RedactionBox `json:"redaction_boxes,omitempty"`
}

type RedactionBox struct {
	Bounds     Rect   `json:"bounds,omitempty"`
	ReasonCode string `json:"reason_code,omitempty"`
}

type SanitizerMetadata struct {
	Version               string            `json:"sanitizer_version,omitempty"`
	Decision              SanitizerDecision `json:"decision,omitempty"`
	ReasonCodes           []string          `json:"reason_codes,omitempty"`
	RedactionRulesApplied []string          `json:"redaction_rules_applied,omitempty"`
	FieldsDropped         []string          `json:"fields_dropped,omitempty"`
	KillSwitchReason      string            `json:"kill_switch_reason,omitempty"`
}

type SignatureEnvelope struct {
	Algorithm          string `json:"algorithm,omitempty"`
	KeyID              string `json:"key_id,omitempty"`
	SignatureBase64    string `json:"signature_base64,omitempty"`
	SignedAtUnixMillis int64  `json:"signed_at_unix_millis,omitempty"`
}

type IngestResponse struct {
	Accepted    bool              `json:"accepted"`
	Decision    SanitizerDecision `json:"decision,omitempty"`
	ReasonCodes []string          `json:"reason_codes,omitempty"`
	Message     string            `json:"message,omitempty"`
}

func CanonicalPayload(frame Frame) ([]byte, error) {
	frame.Signature = nil
	return json.Marshal(frame)
}

func CloneFrame(frame Frame) (Frame, error) {
	payload, err := json.Marshal(frame)
	if err != nil {
		return Frame{}, err
	}
	var clone Frame
	if err := json.Unmarshal(payload, &clone); err != nil {
		return Frame{}, err
	}
	return clone, nil
}

func SHA256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
