package cli

import (
	"context"
	"testing"
)

func TestValidateDomainSyntax(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:    "valid public domain",
			input:   "mcp.example.com",
			want:    "mcp.example.com",
			wantErr: false,
		},
		{
			name:    "valid with https prefix",
			input:   "https://hub.domain.vn/",
			want:    "hub.domain.vn",
			wantErr: false,
		},
		{
			name:    "valid localhost",
			input:   "localhost",
			want:    "localhost",
			wantErr: false,
		},
		{
			name:    "invalid empty",
			input:   "   ",
			wantErr: true,
		},
		{
			name:    "invalid path included",
			input:   "example.com/api/v1",
			wantErr: true,
		},
		{
			name:    "invalid port included",
			input:   "example.com:8443",
			wantErr: true,
		},
		{
			name:    "invalid single label non-localhost",
			input:   "invalidtopdomain",
			wantErr: true,
		},
		{
			name:    "invalid hyphens at start",
			input:   "-sub.example.com",
			wantErr: true,
		},
		{
			name:    "invalid special characters",
			input:   "mcp_domain.example.com",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ValidateDomainSyntax(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateDomainSyntax(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("ValidateDomainSyntax(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDomainBootstrapExecute(t *testing.T) {
	b := &DomainBootstrap{
		Domain:    "mcp.example.com",
		HTTPPort:  8080,
		HTTPSPort: 8443,
		EnableTLS: true,
		TLSMode:   "letsencrypt",
		SkipDNS:   true,
	}

	ctx := context.Background()
	cfg, err := b.Execute(ctx)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	if cfg.Domain != "mcp.example.com" {
		t.Errorf("expected domain mcp.example.com, got %s", cfg.Domain)
	}
	if cfg.MCPEndpoint != "https://mcp.example.com/mcp" {
		t.Errorf("expected MCPEndpoint https://mcp.example.com/mcp, got %s", cfg.MCPEndpoint)
	}
	if cfg.ServerURL != "https://mcp.example.com" {
		t.Errorf("expected ServerURL https://mcp.example.com, got %s", cfg.ServerURL)
	}
	if !cfg.BootstrapComplete {
		t.Errorf("expected BootstrapComplete to be true")
	}
}
