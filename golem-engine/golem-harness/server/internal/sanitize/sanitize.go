package sanitize

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/golem-harness/server/internal/trajectory"
)

const (
	DefaultVersion = "local-sanitizer-v0.1.0"

	ReasonAccepted              = "accepted"
	ReasonSensitivePackage      = "sensitive_package_kill_switch"
	ReasonPackageNotAllowlisted = "package_not_allowlisted"
	ReasonRegexPII              = "regex_sensitive_value_redacted"
	ReasonLocalNER              = "local_ner_sensitive_entity"
	ReasonSanitizerFailure      = "sanitizer_failure"
)

type Sanitizer interface {
	Sanitize(context.Context, trajectory.Frame) (Result, error)
}

type Result struct {
	Frame  trajectory.Frame
	Report Report
}

type Report struct {
	Decision              trajectory.SanitizerDecision
	ReasonCodes           []string
	RedactionRulesApplied []string
	FieldsDropped         []string
	SanitizerVersion      string
	KillSwitchReason      string
}

type Entity struct {
	Type       string
	StartByte  int
	EndByte    int
	Confidence float64
}

type LocalNER interface {
	FindSensitiveEntities(context.Context, string) ([]Entity, error)
}

type VisionRedactor interface {
	RedactScreenshot(context.Context, trajectory.ScreenshotRef) ([]trajectory.RedactionBox, error)
}

type ConservativeNER struct{}

func (ConservativeNER) FindSensitiveEntities(context.Context, string) ([]Entity, error) {
	return nil, nil
}

type NoopVisionRedactor struct{}

func (NoopVisionRedactor) RedactScreenshot(context.Context, trajectory.ScreenshotRef) ([]trajectory.RedactionBox, error) {
	return nil, nil
}

type Pipeline struct {
	AllowedPackages   map[string]struct{}
	SensitivePackages map[string]struct{}
	Version           string
	NER               LocalNER
	Vision            VisionRedactor
}

type Options struct {
	AllowedPackages   []string
	SensitivePackages []string
	Version           string
	NER               LocalNER
	Vision            VisionRedactor
}

func NewPipeline(options Options) *Pipeline {
	allowed := make(map[string]struct{}, len(options.AllowedPackages))
	for _, pkg := range options.AllowedPackages {
		if trimmed := strings.ToLower(strings.TrimSpace(pkg)); trimmed != "" {
			allowed[trimmed] = struct{}{}
		}
	}
	sensitive := defaultSensitivePackages()
	for _, pkg := range options.SensitivePackages {
		if trimmed := strings.ToLower(strings.TrimSpace(pkg)); trimmed != "" {
			sensitive[trimmed] = struct{}{}
		}
	}
	version := options.Version
	if version == "" {
		version = DefaultVersion
	}
	ner := options.NER
	if ner == nil {
		ner = ConservativeNER{}
	}
	vision := options.Vision
	if vision == nil {
		vision = NoopVisionRedactor{}
	}
	return &Pipeline{
		AllowedPackages:   allowed,
		SensitivePackages: sensitive,
		Version:           version,
		NER:               ner,
		Vision:            vision,
	}
}

func (p *Pipeline) Sanitize(ctx context.Context, frame trajectory.Frame) (Result, error) {
	if err := ctx.Err(); err != nil {
		return p.failure(frame, err)
	}
	sanitized, err := trajectory.CloneFrame(frame)
	if err != nil {
		return p.failure(frame, err)
	}
	report := Report{SanitizerVersion: p.version()}
	p.stripSignature(&sanitized, &report)

	pkg := strings.ToLower(strings.TrimSpace(frame.App.ForegroundPackage))
	if p.isSensitivePackage(pkg) {
		report.Decision = trajectory.DecisionQuarantine
		report.KillSwitchReason = ReasonSensitivePackage
		addUnique(&report.ReasonCodes, ReasonSensitivePackage)
		p.clearRawPreStorage(&sanitized, &report)
		p.applyReport(&sanitized, report)
		return Result{Frame: sanitized, Report: report}, nil
	}
	if _, ok := p.AllowedPackages[pkg]; !ok {
		report.Decision = trajectory.DecisionDrop
		addUnique(&report.ReasonCodes, ReasonPackageNotAllowlisted)
		p.clearRawPreStorage(&sanitized, &report)
		p.applyReport(&sanitized, report)
		return Result{Frame: sanitized, Report: report}, nil
	}

	for i := range sanitized.UITree.Nodes {
		if err := p.sanitizeNode(ctx, &sanitized.UITree.Nodes[i], &report, "ui_tree.nodes"); err != nil {
			return p.failure(sanitized, err)
		}
	}
	if sanitized.Screenshot.ReferenceID != "" || sanitized.Screenshot.SHA256 != "" {
		boxes, err := p.Vision.RedactScreenshot(ctx, sanitized.Screenshot)
		if err != nil {
			return p.failure(sanitized, err)
		}
		sanitized.Screenshot.RedactionBoxes = append(sanitized.Screenshot.RedactionBoxes, boxes...)
	}

	report.Decision = trajectory.DecisionAccept
	if len(report.ReasonCodes) == 0 {
		addUnique(&report.ReasonCodes, ReasonAccepted)
	}
	p.applyReport(&sanitized, report)
	return Result{Frame: sanitized, Report: report}, nil
}

func (p *Pipeline) sanitizeNode(ctx context.Context, node *trajectory.UINode, report *Report, path string) error {
	if node.RawTextPreStorage != "" {
		value, err := p.redactRawValue(ctx, node.RawTextPreStorage, path+".raw_text_pre_storage", report)
		if err != nil {
			return err
		}
		node.Text = value
		node.RawTextPreStorage = ""
		addUnique(&report.FieldsDropped, path+".raw_text_pre_storage")
	}
	if node.RawContentDescriptionPreStorage != "" {
		value, err := p.redactRawValue(ctx, node.RawContentDescriptionPreStorage, path+".raw_content_description_pre_storage", report)
		if err != nil {
			return err
		}
		node.ContentDescription = value
		node.RawContentDescriptionPreStorage = ""
		addUnique(&report.FieldsDropped, path+".raw_content_description_pre_storage")
	}
	if node.Text.SHA256 != "" && node.Text.Status == trajectory.RedactionStatusUnspecified {
		node.Text.Status = trajectory.RedactionStatusHashed
	}
	if node.ContentDescription.SHA256 != "" && node.ContentDescription.Status == trajectory.RedactionStatusUnspecified {
		node.ContentDescription.Status = trajectory.RedactionStatusHashed
	}
	for i := range node.Children {
		childPath := fmt.Sprintf("%s.children[%d]", path, i)
		if err := p.sanitizeNode(ctx, &node.Children[i], report, childPath); err != nil {
			return err
		}
	}
	return nil
}

func (p *Pipeline) redactRawValue(ctx context.Context, value, fieldPath string, report *Report) (trajectory.RedactedValue, error) {
	redacted := false
	for _, rule := range regexRules {
		if rule.pattern.MatchString(value) {
			redacted = true
			addUnique(&report.ReasonCodes, ReasonRegexPII)
			addUnique(&report.RedactionRulesApplied, rule.name)
		}
	}
	entities, err := p.NER.FindSensitiveEntities(ctx, value)
	if err != nil {
		return trajectory.RedactedValue{}, err
	}
	if len(entities) > 0 {
		redacted = true
		addUnique(&report.ReasonCodes, ReasonLocalNER)
		addUnique(&report.RedactionRulesApplied, "local_ner")
	}
	if redacted {
		addUnique(&report.FieldsDropped, fieldPath)
		return trajectory.RedactedValue{Status: trajectory.RedactionStatusRedacted}, nil
	}
	return trajectory.RedactedValue{
		Status: trajectory.RedactionStatusHashed,
		SHA256: trajectory.SHA256Hex(value),
	}, nil
}

func (p *Pipeline) failure(frame trajectory.Frame, err error) (Result, error) {
	sanitized, cloneErr := trajectory.CloneFrame(frame)
	if cloneErr != nil {
		sanitized = trajectory.Frame{
			ProtocolVersion: frame.ProtocolVersion,
			TrajectoryID:    frame.TrajectoryID,
			FrameID:         frame.FrameID,
			SequenceNumber:  frame.SequenceNumber,
			Device:          frame.Device,
			App:             frame.App,
		}
	}
	report := Report{
		Decision:         trajectory.DecisionDrop,
		ReasonCodes:      []string{ReasonSanitizerFailure},
		SanitizerVersion: p.version(),
	}
	p.stripSignature(&sanitized, &report)
	p.clearRawPreStorage(&sanitized, &report)
	p.applyReport(&sanitized, report)
	if err == nil {
		err = errors.New("sanitizer failed")
	}
	return Result{Frame: sanitized, Report: report}, err
}

func (p *Pipeline) stripSignature(frame *trajectory.Frame, report *Report) {
	if frame.Signature != nil {
		frame.Signature = nil
		addUnique(&report.FieldsDropped, "signature")
	}
}

func (p *Pipeline) clearRawPreStorage(frame *trajectory.Frame, report *Report) {
	for i := range frame.UITree.Nodes {
		clearRawNode(&frame.UITree.Nodes[i], report, "ui_tree.nodes")
	}
}

func clearRawNode(node *trajectory.UINode, report *Report, path string) {
	if node.RawTextPreStorage != "" {
		node.RawTextPreStorage = ""
		addUnique(&report.FieldsDropped, path+".raw_text_pre_storage")
	}
	if node.RawContentDescriptionPreStorage != "" {
		node.RawContentDescriptionPreStorage = ""
		addUnique(&report.FieldsDropped, path+".raw_content_description_pre_storage")
	}
	for i := range node.Children {
		clearRawNode(&node.Children[i], report, fmt.Sprintf("%s.children[%d]", path, i))
	}
}

func (p *Pipeline) applyReport(frame *trajectory.Frame, report Report) {
	frame.Sanitizer = trajectory.SanitizerMetadata{
		Version:               report.SanitizerVersion,
		Decision:              report.Decision,
		ReasonCodes:           append([]string(nil), report.ReasonCodes...),
		RedactionRulesApplied: append([]string(nil), report.RedactionRulesApplied...),
		FieldsDropped:         append([]string(nil), report.FieldsDropped...),
		KillSwitchReason:      report.KillSwitchReason,
	}
	frame.AllowlistDecision = trajectory.AllowlistDecision{
		Allowed:             report.Decision == trajectory.DecisionAccept,
		KillSwitchTriggered: report.Decision == trajectory.DecisionQuarantine,
		ReasonCode:          firstReason(report),
		PolicyVersion:       p.version(),
	}
}

func (p *Pipeline) isSensitivePackage(pkg string) bool {
	if pkg == "" {
		return false
	}
	if _, ok := p.SensitivePackages[pkg]; ok {
		return true
	}
	for sensitive := range p.SensitivePackages {
		if strings.HasPrefix(pkg, sensitive+".") {
			return true
		}
	}
	return false
}

func (p *Pipeline) version() string {
	if p != nil && p.Version != "" {
		return p.Version
	}
	return DefaultVersion
}

func firstReason(report Report) string {
	if len(report.ReasonCodes) == 0 {
		return ""
	}
	return report.ReasonCodes[0]
}

func addUnique(values *[]string, value string) {
	if value == "" {
		return
	}
	for _, existing := range *values {
		if existing == value {
			return
		}
	}
	*values = append(*values, value)
}

func defaultSensitivePackages() map[string]struct{} {
	packages := []string{
		"com.android.email",
		"com.google.android.gm",
		"com.google.android.apps.messaging",
		"com.whatsapp",
		"com.signal",
		"org.telegram.messenger",
		"com.onepassword.android",
		"com.lastpass.lpandroid",
		"com.bitwarden",
		"com.synthetic.bank",
		"com.synthetic.medical",
	}
	out := make(map[string]struct{}, len(packages))
	for _, pkg := range packages {
		out[pkg] = struct{}{}
	}
	return out
}

type regexRule struct {
	name    string
	pattern *regexp.Regexp
}

var regexRules = []regexRule{
	{name: "email", pattern: regexp.MustCompile(`(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b`)},
	{name: "phone", pattern: regexp.MustCompile(`(?i)(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}\b`)},
	{name: "ssn", pattern: regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)},
	{name: "payment_card", pattern: regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`)},
	{name: "street_address", pattern: regexp.MustCompile(`(?i)\b\d{1,6}\s+[A-Z0-9][A-Z0-9 .'\-]{1,80}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b`)},
	{name: "bearer_or_api_token", pattern: regexp.MustCompile(`(?i)\b(?:bearer\s+|api[_-]?key\s*[:=]\s*|token\s*[:=]\s*|sk[_-])[A-Z0-9._\-]{16,}\b`)},
	{name: "long_numeric_identifier", pattern: regexp.MustCompile(`\b\d{9,}\b`)},
}
