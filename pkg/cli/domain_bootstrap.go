package cli

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/obot-platform/obot/pkg/domain"
	"github.com/spf13/cobra"
)

// DomainBootstrap manages the first-run domain and HTTPS validation and persistence.
type DomainBootstrap struct {
	Domain    string `usage:"Public domain name (e.g. mcp.example.com)" local:"true"`
	HTTPPort  int    `usage:"HTTP port to bind/listen" default:"8080" local:"true"`
	HTTPSPort int    `usage:"HTTPS port to bind/listen" default:"8443" local:"true"`
	EnableTLS bool   `usage:"Enable TLS / HTTPS for the domain" default:"true" local:"true"`
	TLSMode   string `usage:"TLS certificate mode: letsencrypt, custom, or none" default:"letsencrypt" local:"true"`
	CertPath  string `usage:"Path to TLS certificate (when tls-mode is custom)" local:"true"`
	KeyPath   string `usage:"Path to TLS private key (when tls-mode is custom)" local:"true"`
	SkipDNS   bool   `usage:"Skip DNS resolution verification" default:"false" local:"true"`
	EnvFile   string `usage:"Path to write runtime environment variables" local:"true"`
	Output    string `usage:"Output format: text or json" default:"text" local:"true"`
}

func (d *DomainBootstrap) Customize(c *cobra.Command) {
	c.Use = "domain-bootstrap"
	c.Short = "First-run domain syntax validation, DNS check, HTTPS bootstrap, and runtime config persistence"
	c.Args = cobra.NoArgs
}

func (d *DomainBootstrap) Run(cmd *cobra.Command, _ []string) error {
	ctx := cmd.Context()
	opts := domain.BootstrapOptions{
		Domain:    d.Domain,
		HTTPPort:  d.HTTPPort,
		HTTPSPort: d.HTTPSPort,
		EnableTLS: d.EnableTLS,
		TLSMode:   d.TLSMode,
		CertPath:  d.CertPath,
		KeyPath:   d.KeyPath,
		SkipDNS:   d.SkipDNS,
		EnvFile:   d.EnvFile,
	}

	config, err := domain.ExecuteBootstrap(ctx, opts)
	if err != nil {
		if d.Output == "json" {
			errResp := map[string]string{
				"status": "error",
				"error":  err.Error(),
			}
			_ = json.NewEncoder(cmd.OutOrStdout()).Encode(errResp)
			return err
		}
		return err
	}

	if d.Output == "json" {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(config)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "=== Gen Hub Domain Bootstrap ===\n")
	fmt.Fprintf(cmd.OutOrStdout(), "Domain:        %s\n", config.Domain)
	fmt.Fprintf(cmd.OutOrStdout(), "Server URL:    %s\n", config.ServerURL)
	fmt.Fprintf(cmd.OutOrStdout(), "MCP Endpoint:  %s\n", config.MCPEndpoint)
	fmt.Fprintf(cmd.OutOrStdout(), "DNS Status:    %s\n", config.DNSStatus)
	if len(config.ResolvedIPs) > 0 {
		fmt.Fprintf(cmd.OutOrStdout(), "Resolved IPs:  %s\n", strings.Join(config.ResolvedIPs, ", "))
	}
	fmt.Fprintf(cmd.OutOrStdout(), "TLS Enabled:   %t (Mode: %s)\n", config.EnableTLS, config.TLSMode)
	fmt.Fprintf(cmd.OutOrStdout(), "Status:        Ready for Hub startup\n")
	return nil
}
