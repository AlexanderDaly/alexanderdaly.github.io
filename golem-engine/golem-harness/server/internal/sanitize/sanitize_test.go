package sanitize_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golem-harness/server/internal/sanitize"
	"github.com/golem-harness/server/internal/testutil"
	"github.com/golem-harness/server/internal/trajectory"
)

func TestSensitivePackageKillSwitchQuarantinesFrame(t *testing.T) {
	pipeline := testPipeline()
	frame := testutil.SyntheticFrame(time.Now(), "com.synthetic.bank")

	result, err := pipeline.Sanitize(context.Background(), frame)
	if err != nil {
		t.Fatalf("Sanitize returned error: %v", err)
	}
	if result.Report.Decision != trajectory.DecisionQuarantine {
		t.Fatalf("expected quarantine decision, got %q", result.Report.Decision)
	}
	if !contains(result.Report.ReasonCodes, sanitize.ReasonSensitivePackage) {
		t.Fatalf("missing sensitive package reason: %#v", result.Report.ReasonCodes)
	}
}

func TestNonAllowlistedPackageDropsByDefault(t *testing.T) {
	pipeline := testPipeline()
	frame := testutil.SyntheticFrame(time.Now(), "com.example.unlisted")

	result, err := pipeline.Sanitize(context.Background(), frame)
	if err != nil {
		t.Fatalf("Sanitize returned error: %v", err)
	}
	if result.Report.Decision != trajectory.DecisionDrop {
		t.Fatalf("expected drop decision, got %q", result.Report.Decision)
	}
	if !contains(result.Report.ReasonCodes, sanitize.ReasonPackageNotAllowlisted) {
		t.Fatalf("missing allowlist reason: %#v", result.Report.ReasonCodes)
	}
}

func TestRegexSensitiveValuesAreRedacted(t *testing.T) {
	cases := []struct {
		name  string
		value string
		rule  string
	}{
		{name: "email", value: "Synthetic email test@example.invalid", rule: "email"},
		{name: "phone", value: "Synthetic phone 415-555-0100", rule: "phone"},
		{name: "address", value: "Synthetic address 123 Main St", rule: "street_address"},
		{name: "ssn", value: "Synthetic SSN 123-45-6789", rule: "ssn"},
		{name: "payment card", value: "Synthetic card 4111 1111 1111 1111", rule: "payment_card"},
		{name: "api token", value: "Synthetic token Bearer abcdefghijklmnopqrstuvwxyz123456", rule: "bearer_or_api_token"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pipeline := testPipeline()
			frame := testutil.SyntheticFrame(time.Now(), "com.example.safe")
			frame.UITree.Nodes[0].RawTextPreStorage = tc.value

			result, err := pipeline.Sanitize(context.Background(), frame)
			if err != nil {
				t.Fatalf("Sanitize returned error: %v", err)
			}
			if result.Report.Decision != trajectory.DecisionAccept {
				t.Fatalf("expected accept decision, got %q", result.Report.Decision)
			}
			if result.Frame.UITree.Nodes[0].Text.Status != trajectory.RedactionStatusRedacted {
				t.Fatalf("expected redacted text, got %#v", result.Frame.UITree.Nodes[0].Text)
			}
			if strings.Contains(testutil.MustJSON(t, result.Frame), tc.value) {
				t.Fatalf("sanitized frame contains raw sensitive value")
			}
			if !contains(result.Report.RedactionRulesApplied, tc.rule) {
				t.Fatalf("missing rule %q in %#v", tc.rule, result.Report.RedactionRulesApplied)
			}
		})
	}
}

func TestSanitizerFailureFailsClosed(t *testing.T) {
	pipeline := sanitize.NewPipeline(sanitize.Options{
		AllowedPackages: []string{"com.example.safe"},
		NER:             failingNER{},
	})
	frame := testutil.SyntheticFrame(time.Now(), "com.example.safe")

	result, err := pipeline.Sanitize(context.Background(), frame)
	if err == nil {
		t.Fatal("expected sanitizer error")
	}
	if result.Report.Decision != trajectory.DecisionDrop {
		t.Fatalf("expected drop decision, got %q", result.Report.Decision)
	}
	if !contains(result.Report.ReasonCodes, sanitize.ReasonSanitizerFailure) {
		t.Fatalf("missing failure reason: %#v", result.Report.ReasonCodes)
	}
}

func testPipeline() *sanitize.Pipeline {
	return sanitize.NewPipeline(sanitize.Options{
		AllowedPackages: []string{"com.example.safe"},
	})
}

type failingNER struct{}

func (failingNER) FindSensitiveEntities(context.Context, string) ([]sanitize.Entity, error) {
	return nil, errors.New("synthetic local NER failure")
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
