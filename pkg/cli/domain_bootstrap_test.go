package cli

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/obot-platform/obot/pkg/domain"
	"github.com/spf13/cobra"
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

func TestDomainBootstrapCommandPersistsConfigurationWithoutClaimingReady(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(domain.RuntimeConfigFileEnv, filepath.Join(tmpDir, "runtime-config.json"))
	var stdout bytes.Buffer
	command := &cobra.Command{}
	command.SetContext(context.Background())
	command.SetOut(&stdout)
	bootstrap := &DomainBootstrap{
		Domain:    "hub.example.com",
		HTTPPort:  8080,
		HTTPSPort: 443,
		EnableTLS: true,
		TLSMode:   domain.TLSModeLetsEncrypt,
		SkipDNS:   true,
		EnvFile:   filepath.Join(tmpDir, "runtime.env"),
		Output:    "text",
	}

	if err := bootstrap.Run(command, nil); err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	output := stdout.String()
	if !strings.Contains(output, "Config State:  tls_pending") {
		t.Fatalf("missing truthful config state:\n%s", output)
	}
	if strings.Contains(output, "Ready for Hub startup") {
		t.Fatalf("command must not claim full readiness:\n%s", output)
	}
}

func TestDomainBootstrapCommandRejectsInvalidOutputBeforeWriting(t *testing.T) {
	tmpDir := t.TempDir()
	runtimePath := filepath.Join(tmpDir, "runtime-config.json")
	t.Setenv(domain.RuntimeConfigFileEnv, runtimePath)
	bootstrap := &DomainBootstrap{Domain: "hub.example.com", Output: "yaml"}

	if err := bootstrap.Run(&cobra.Command{}, nil); err == nil {
		t.Fatal("expected unsupported output format to fail")
	}
}
