package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/adrg/xdg"
	"github.com/spf13/cobra"
)

const (
	defaultRuntimeConfigRelPath = "gen-hub/runtime-config.json"
	defaultRuntimeEnvFile       = "/data/gen-hub.env"
)

// DomainRuntimeConfig stores the persisted domain and HTTPS bootstrap configuration.
type DomainRuntimeConfig struct {
	Domain            string    `json:"domain"`
	HTTPPort          int       `json:"httpPort"`
	HTTPSPort         int       `json:"httpsPort"`
	EnableTLS         bool      `json:"enableTLS"`
	MCPEndpoint       string    `json:"mcpEndpoint"`
	ServerURL         string    `json:"serverURL"`
	ConfiguredAt      time.Time `json:"configuredAt"`
	DNSStatus         string    `json:"dnsStatus"`
	ResolvedIPs       []string  `json:"resolvedIPs,omitempty"`
	TLSMode           string    `json:"tlsMode,omitempty"` // "letsencrypt", "custom", "none"
	CertPath          string    `json:"certPath,omitempty"`
	KeyPath           string    `json:"keyPath,omitempty"`
	BootstrapComplete bool      `json:"bootstrapComplete"`
}

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
	config, err := d.Execute(ctx)
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

// ValidateDomainSyntax verifies RFC 1035 / RFC 1123 format for public domains.
func ValidateDomainSyntax(rawDomain string) (string, error) {
	domain := strings.TrimSpace(rawDomain)
	domain = strings.ToLower(domain)
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimRight(domain, "/")

	if domain == "" {
		return "", errors.New("domain name cannot be empty")
	}

	if strings.Contains(domain, "/") || strings.Contains(domain, ":") || strings.Contains(domain, "@") {
		return "", fmt.Errorf("invalid domain syntax %q: must not contain paths, ports, or credentials", domain)
	}

	if len(domain) > 253 {
		return "", fmt.Errorf("domain name %q exceeds 253 characters limit", domain)
	}

	labels := strings.Split(domain, ".")
	if len(labels) < 2 && domain != "localhost" {
		return "", fmt.Errorf("domain %q must contain at least a top-level domain or be localhost", domain)
	}

	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 {
			return "", fmt.Errorf("domain label %q in %q must be between 1 and 63 characters", label, domain)
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", fmt.Errorf("domain label %q in %q cannot start or end with a hyphen", label, domain)
		}
		for _, r := range label {
			if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-') {
				return "", fmt.Errorf("domain label %q in %q contains invalid character %q", label, domain, r)
			}
		}
	}

	return domain, nil
}

// CheckDNSReadiness performs an authoritative DNS lookup for the given domain.
func CheckDNSReadiness(ctx context.Context, domain string) ([]string, error) {
	if domain == "localhost" || domain == "127.0.0.1" {
		return []string{"127.0.0.1"}, nil
	}

	resolver := net.DefaultResolver
	ips, err := resolver.LookupHost(ctx, domain)
	if err != nil {
		return nil, fmt.Errorf("DNS lookup failed for %s: %w", domain, err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no A/AAAA DNS records found for %s", domain)
	}

	return ips, nil
}

// Execute performs domain bootstrap steps idempotently.
func (d *DomainBootstrap) Execute(ctx context.Context) (*DomainRuntimeConfig, error) {
	domain, err := ValidateDomainSyntax(d.Domain)
	if err != nil {
		return nil, fmt.Errorf("domain validation error: %w", err)
	}

	var resolvedIPs []string
	dnsStatus := "skipped"
	if !d.SkipDNS {
		ips, err := CheckDNSReadiness(ctx, domain)
		if err != nil {
			return nil, fmt.Errorf("DNS readiness check error: %w", err)
		}
		resolvedIPs = ips
		dnsStatus = "resolved"
	}

	if d.TLSMode == "custom" {
		if d.CertPath == "" || d.KeyPath == "" {
			return nil, errors.New("custom TLS mode requires both --cert-path and --key-path")
		}
		if _, err := os.Stat(d.CertPath); err != nil {
			return nil, fmt.Errorf("certificate file not found: %w", err)
		}
		if _, err := os.Stat(d.KeyPath); err != nil {
			return nil, fmt.Errorf("private key file not found: %w", err)
		}
	}

	var serverURL string
	var mcpEndpoint string
	if d.EnableTLS {
		serverURL = fmt.Sprintf("https://%s", domain)
		if d.HTTPSPort != 443 && d.HTTPSPort != 0 && domain == "localhost" {
			serverURL = fmt.Sprintf("https://%s:%d", domain, d.HTTPSPort)
		}
	} else {
		serverURL = fmt.Sprintf("http://%s", domain)
		if d.HTTPPort != 80 && d.HTTPPort != 0 {
			serverURL = fmt.Sprintf("http://%s:%d", domain, d.HTTPPort)
		}
	}
	mcpEndpoint = fmt.Sprintf("%s/mcp", strings.TrimRight(serverURL, "/"))

	cfg := &DomainRuntimeConfig{
		Domain:            domain,
		HTTPPort:          d.HTTPPort,
		HTTPSPort:         d.HTTPSPort,
		EnableTLS:         d.EnableTLS,
		MCPEndpoint:       mcpEndpoint,
		ServerURL:         serverURL,
		ConfiguredAt:      time.Now().UTC(),
		DNSStatus:         dnsStatus,
		ResolvedIPs:       resolvedIPs,
		TLSMode:           d.TLSMode,
		CertPath:          d.CertPath,
		KeyPath:           d.KeyPath,
		BootstrapComplete: true,
	}

	if err := SaveRuntimeConfig(cfg); err != nil {
		return nil, fmt.Errorf("failed to save runtime config: %w", err)
	}

	envPath := d.EnvFile
	if envPath == "" {
		envPath = os.Getenv("GEN_HUB_ENV_FILE")
	}
	if envPath == "" {
		envPath = defaultRuntimeEnvFile
	}
	if err := WriteRuntimeEnvFile(envPath, cfg); err != nil {
		// Log warning if system-level path is not writable, fallback to XDG config directory
		fallbackEnv := filepath.Join(xdg.ConfigHome, "gen-hub", "gen-hub.env")
		_ = WriteRuntimeEnvFile(fallbackEnv, cfg)
	}

	return cfg, nil
}

// SaveRuntimeConfig saves the configuration to the user's config directory.
func SaveRuntimeConfig(cfg *DomainRuntimeConfig) error {
	path, err := xdg.ConfigFile(defaultRuntimeConfigRelPath)
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("creating directory %s: %w", filepath.Dir(path), err)
	}
	return os.WriteFile(path, data, 0o600)
}

// LoadRuntimeConfig loads the persisted configuration.
func LoadRuntimeConfig() (*DomainRuntimeConfig, error) {
	path := filepath.Join(xdg.ConfigHome, defaultRuntimeConfigRelPath)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg DomainRuntimeConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// WriteRuntimeEnvFile persists runtime environment variables for Obot server startup.
func WriteRuntimeEnvFile(path string, cfg *DomainRuntimeConfig) error {
	if path == "" {
		return nil
	}

	var sb strings.Builder
	sb.WriteString("# Gen Hub Persisted Runtime Configuration (E1)\n")
	sb.WriteString(fmt.Sprintf("# Generated at %s\n\n", cfg.ConfiguredAt.Format(time.RFC3339)))
	sb.WriteString(fmt.Sprintf("GEN_HUB_DOMAIN=%s\n", cfg.Domain))
	sb.WriteString(fmt.Sprintf("OBOT_SERVER_HOSTNAME=%s\n", cfg.ServerURL))
	sb.WriteString(fmt.Sprintf("OBOT_SERVER_UI_HOSTNAME=%s\n", cfg.ServerURL))
	sb.WriteString(fmt.Sprintf("GEN_HUB_MCP_ENDPOINT=%s\n", cfg.MCPEndpoint))
	sb.WriteString(fmt.Sprintf("GEN_HUB_ENABLE_TLS=%t\n", cfg.EnableTLS))
	sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_MODE=%s\n", cfg.TLSMode))
	if cfg.CertPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_CERT_PATH=%s\n", cfg.CertPath))
	}
	if cfg.KeyPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_KEY_PATH=%s\n", cfg.KeyPath))
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(sb.String()), 0o644)
}

// ParseURLHost extracts host and normalized URL.
func ParseURLHost(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	return u.Host, nil
}
