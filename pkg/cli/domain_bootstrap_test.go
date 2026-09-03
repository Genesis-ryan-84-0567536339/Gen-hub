package cli

import (
	"testing"
)

func TestDomainBootstrapCommand(t *testing.T) {
	b := &DomainBootstrap{
		Domain:    "mcp.example.com",
		HTTPPort:  8080,
		HTTPSPort: 8443,
		EnableTLS: true,
		TLSMode:   "letsencrypt",
		SkipDNS:   true,
	}

	if b.Domain != "mcp.example.com" {
		t.Errorf("expected domain mcp.example.com, got %s", b.Domain)
	}
}
