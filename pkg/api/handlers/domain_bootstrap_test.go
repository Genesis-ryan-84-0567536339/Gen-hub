package handlers

import (
	"context"
	"testing"

	"github.com/obot-platform/obot/pkg/cli"
)

func TestDomainValidationLogic(t *testing.T) {
	validDomains := []string{
		"mcp.example.com",
		"hub.internal.lan",
		"localhost",
	}

	for _, d := range validDomains {
		norm, err := cli.ValidateDomainSyntax(d)
		if err != nil {
			t.Errorf("expected valid domain for %q, got error: %v", d, err)
		}
		if norm == "" {
			t.Errorf("expected non-empty normalized domain for %q", d)
		}
	}

	invalidDomains := []string{
		"",
		"http://mcp.example.com:8080/path",
		"invalid..domain",
		"-bad-label.com",
	}

	for _, d := range invalidDomains {
		_, err := cli.ValidateDomainSyntax(d)
		if err == nil {
			t.Errorf("expected error for invalid domain %q, got nil", d)
		}
	}
}

func TestLocalhostDNSReadiness(t *testing.T) {
	ips, err := cli.CheckDNSReadiness(context.Background(), "localhost")
	if err != nil {
		t.Fatalf("unexpected error for localhost DNS check: %v", err)
	}
	if len(ips) == 0 || ips[0] != "127.0.0.1" {
		t.Errorf("expected localhost to resolve to 127.0.0.1, got: %v", ips)
	}
}
