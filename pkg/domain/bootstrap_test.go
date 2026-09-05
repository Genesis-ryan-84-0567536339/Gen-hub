package domain

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	t.Setenv(RuntimeConfigFileEnv, filepath.Join(tmpDir, "runtime-config.json"))

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
	if cfg.BootstrapComplete {
		t.Errorf("expected BootstrapComplete to remain false until all first-run checks pass")
	}
	if !cfg.ConfigComplete {
		t.Errorf("expected ConfigComplete to be true")
	}
	if cfg.State != BootstrapStateTLSPending {
		t.Errorf("expected state %q, got %q", BootstrapStateTLSPending, cfg.State)
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

func TestExecuteBootstrapDNSFailurePersistsState(t *testing.T) {
	tmpDir := t.TempDir()
	runtimePath := filepath.Join(tmpDir, "runtime-config.json")
	t.Setenv(RuntimeConfigFileEnv, runtimePath)

	wantErr := errors.New("no matching A or AAAA record")
	_, err := executeBootstrap(context.Background(), BootstrapOptions{
		Domain:    "hub.example.com",
		HTTPPort:  8080,
		HTTPSPort: 443,
		TLSMode:   TLSModeLetsEncrypt,
		EnvFile:   filepath.Join(tmpDir, "runtime.env"),
	}, func(context.Context, string) ([]string, error) {
		return nil, wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected DNS error %v, got %v", wantErr, err)
	}

	cfg, err := LoadRuntimeConfig()
	if err != nil {
		t.Fatalf("failed to load persisted failure state: %v", err)
	}
	if cfg.State != BootstrapStateDNSNotReady {
		t.Fatalf("expected state %q, got %q", BootstrapStateDNSNotReady, cfg.State)
	}
	if cfg.DNSStatus != "not_ready" || cfg.Error != wantErr.Error() {
		t.Fatalf("unexpected persisted DNS failure: status=%q error=%q", cfg.DNSStatus, cfg.Error)
	}
	if cfg.ConfigComplete || cfg.BootstrapComplete {
		t.Fatal("failed DNS bootstrap must not be marked complete")
	}
}

func TestExecuteBootstrapSameInputKeepsConfiguredAt(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(RuntimeConfigFileEnv, filepath.Join(tmpDir, "runtime-config.json"))
	opts := BootstrapOptions{
		Domain:    "hub.example.com",
		HTTPPort:  8080,
		HTTPSPort: 443,
		TLSMode:   TLSModeLetsEncrypt,
		SkipDNS:   true,
		EnvFile:   filepath.Join(tmpDir, "runtime.env"),
	}

	first, err := ExecuteBootstrap(context.Background(), opts)
	if err != nil {
		t.Fatalf("first bootstrap failed: %v", err)
	}
	time.Sleep(time.Millisecond)
	second, err := ExecuteBootstrap(context.Background(), opts)
	if err != nil {
		t.Fatalf("second bootstrap failed: %v", err)
	}
	if !second.ConfiguredAt.Equal(first.ConfiguredAt) {
		t.Fatalf("same input changed configuredAt from %s to %s", first.ConfiguredAt, second.ConfiguredAt)
	}
}

func TestExecuteBootstrapRejectsInvalidPorts(t *testing.T) {
	t.Setenv(RuntimeConfigFileEnv, filepath.Join(t.TempDir(), "runtime-config.json"))
	for _, opts := range []BootstrapOptions{
		{Domain: "hub.example.com", HTTPPort: -1, HTTPSPort: 443, TLSMode: TLSModeNone, SkipDNS: true},
		{Domain: "hub.example.com", HTTPPort: 80, HTTPSPort: 65536, TLSMode: TLSModeLetsEncrypt, SkipDNS: true},
	} {
		if _, err := ExecuteBootstrap(context.Background(), opts); err == nil {
			t.Fatalf("expected invalid ports to fail: %+v", opts)
		}
	}
}

func TestWriteRuntimeFilesAtomicallyWithStrictPermissions(t *testing.T) {
	tmpDir := t.TempDir()
	runtimePath := filepath.Join(tmpDir, "runtime-config.json")
	envPath := filepath.Join(tmpDir, "runtime.env")
	t.Setenv(RuntimeConfigFileEnv, runtimePath)
	cfg := &RuntimeConfig{
		Domain:       "hub.example.com",
		ServerURL:    "https://hub.example.com",
		MCPEndpoint:  "https://hub.example.com/mcp",
		ConfiguredAt: time.Date(2026, time.September, 4, 1, 2, 3, 0, time.UTC),
		TLSMode:      TLSModeCustom,
		CertPath:     "/data/TLS certs/cert #1.pem",
		KeyPath:      "/data/TLS certs/key #1.pem",
	}

	if err := SaveRuntimeConfig(cfg); err != nil {
		t.Fatalf("SaveRuntimeConfig failed: %v", err)
	}
	if err := WriteRuntimeEnvFile(envPath, cfg); err != nil {
		t.Fatalf("WriteRuntimeEnvFile failed: %v", err)
	}
	for _, path := range []string{runtimePath, envPath} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("failed to stat %s: %v", path, err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("expected %s mode 0600, got %o", path, info.Mode().Perm())
		}
	}
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("temporary file was not cleaned up: %s", entry.Name())
		}
	}
	envData, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(envData), `GEN_HUB_TLS_CERT_PATH="/data/TLS certs/cert #1.pem"`) {
		t.Fatalf("certificate path was not safely quoted:\n%s", envData)
	}
}

func TestExecuteBootstrapReportsEnvironmentWriteFailure(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(RuntimeConfigFileEnv, filepath.Join(tmpDir, "runtime-config.json"))
	_, err := ExecuteBootstrap(context.Background(), BootstrapOptions{
		Domain:    "hub.example.com",
		HTTPPort:  8080,
		HTTPSPort: 443,
		TLSMode:   TLSModeLetsEncrypt,
		SkipDNS:   true,
		EnvFile:   tmpDir,
	})
	if err == nil || !strings.Contains(err.Error(), "failed to write runtime environment file") {
		t.Fatalf("expected environment write error, got %v", err)
	}
	cfg, loadErr := LoadRuntimeConfig()
	if loadErr != nil {
		t.Fatalf("failed to load persisted error state: %v", loadErr)
	}
	if cfg.State != BootstrapStateError || cfg.ConfigComplete {
		t.Fatalf("unexpected state after environment write failure: %+v", cfg)
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
