package domain

import (
	"context"
	"os"
	"path/filepath"
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

func TestNormalizeTLSMode(t *testing.T) {
	tests := []struct {
		mode      string
		enableTLS bool
		wantMode  string
		wantTLS   bool
		wantErr   bool
	}{
		{"none", true, "none", false, false},
		{"letsencrypt", false, "letsencrypt", true, false},
		{"custom", true, "custom", true, false},
		{"", true, "letsencrypt", true, false},
		{"", false, "none", false, false},
		{"invalid_mode", true, "", false, true},
	}

	for _, tt := range tests {
		mode, enabled, err := NormalizeTLSMode(tt.mode, tt.enableTLS)
		if (err != nil) != tt.wantErr {
			t.Errorf("NormalizeTLSMode(%q, %t) error = %v, wantErr %v", tt.mode, tt.enableTLS, err, tt.wantErr)
			continue
		}
		if !tt.wantErr {
			if mode != tt.wantMode || enabled != tt.wantTLS {
				t.Errorf("NormalizeTLSMode(%q, %t) = (%s, %t), want (%s, %t)", tt.mode, tt.enableTLS, mode, enabled, tt.wantMode, tt.wantTLS)
			}
		}
	}
}

func TestExecuteBootstrap(t *testing.T) {
	tmpDir := t.TempDir()
	envPath := filepath.Join(tmpDir, "test.env")

	opts := BootstrapOptions{
		Domain:    "mcp.example.com",
		HTTPPort:  8080,
		HTTPSPort: 8443,
		EnableTLS: true,
		TLSMode:   "letsencrypt",
		SkipDNS:   true,
		EnvFile:   envPath,
	}

	ctx := context.Background()
	cfg, err := ExecuteBootstrap(ctx, opts)
	if err != nil {
		t.Fatalf("ExecuteBootstrap failed: %v", err)
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

	// Verify file permissions (0600)
	fi, err := os.Stat(envPath)
	if err != nil {
		t.Fatalf("failed to stat env file: %v", err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("expected env file mode 0600, got %o", fi.Mode().Perm())
	}
}

func TestLocalhostDNSReadiness(t *testing.T) {
	ips, err := CheckDNSReadiness(context.Background(), "localhost")
	if err != nil {
		t.Fatalf("unexpected error for localhost DNS check: %v", err)
	}
	if len(ips) == 0 || ips[0] != "127.0.0.1" {
		t.Errorf("expected localhost to resolve to 127.0.0.1, got: %v", ips)
	}
}
