package domain

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
)

const (
	DefaultRuntimeConfigRelPath = "gen-hub/runtime-config.json"
	DefaultRuntimeEnvFile       = "/data/gen-hub.env"
)

// TLSMode constants
const (
	TLSModeNone        = "none"
	TLSModeLetsEncrypt = "letsencrypt"
	TLSModeCustom      = "custom"
)

// RuntimeConfig stores the persisted domain and HTTPS bootstrap configuration.
type RuntimeConfig struct {
	Domain            string    `json:"domain"`
	HTTPPort          int       `json:"httpPort"`
	HTTPSPort         int       `json:"httpsPort"`
	EnableTLS         bool      `json:"enableTLS"`
	MCPEndpoint       string    `json:"mcpEndpoint"`
	ServerURL         string    `json:"serverURL"`
	ConfiguredAt      time.Time `json:"configuredAt"`
	DNSStatus         string    `json:"dnsStatus"`
	ResolvedIPs       []string  `json:"resolvedIPs,omitempty"`
	TLSMode           string    `json:"tlsMode"` // "letsencrypt", "custom", "none"
	CertPath          string    `json:"certPath,omitempty"`
	KeyPath           string    `json:"keyPath,omitempty"`
	BootstrapComplete bool      `json:"bootstrapComplete"`
}

// BootstrapOptions holds options for bootstrapping domain and TLS.
type BootstrapOptions struct {
	Domain    string
	HTTPPort  int
	HTTPSPort int
	EnableTLS bool
	TLSMode   string
	CertPath  string
	KeyPath   string
	SkipDNS   bool
	EnvFile   string
}

// NormalizeTLSMode normalizes and validates the TLS mode and EnableTLS semantics.
// - "none" => HTTP (EnableTLS = false)
// - "letsencrypt" => HTTPS (EnableTLS = true)
// - "custom" => HTTPS (EnableTLS = true, requires cert and key)
func NormalizeTLSMode(mode string, enableTLS bool) (string, bool, error) {
	norm := strings.ToLower(strings.TrimSpace(mode))
	if norm == "" {
		if enableTLS {
			norm = TLSModeLetsEncrypt
		} else {
			norm = TLSModeNone
		}
	}

	switch norm {
	case TLSModeNone:
		return TLSModeNone, false, nil
	case TLSModeLetsEncrypt:
		return TLSModeLetsEncrypt, true, nil
	case TLSModeCustom:
		return TLSModeCustom, true, nil
	default:
		return "", false, fmt.Errorf("invalid tls-mode %q: must be 'letsencrypt', 'custom', or 'none'", mode)
	}
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

// ExecuteBootstrap executes the first-run domain and HTTPS configuration idempotently.
func ExecuteBootstrap(ctx context.Context, opts BootstrapOptions) (*RuntimeConfig, error) {
	domain, err := ValidateDomainSyntax(opts.Domain)
	if err != nil {
		return nil, fmt.Errorf("domain validation error: %w", err)
	}

	tlsMode, enableTLS, err := NormalizeTLSMode(opts.TLSMode, opts.EnableTLS)
	if err != nil {
		return nil, err
	}

	var resolvedIPs []string
	dnsStatus := "skipped"
	if !opts.SkipDNS {
		ips, err := CheckDNSReadiness(ctx, domain)
		if err != nil {
			return nil, fmt.Errorf("DNS readiness check failed: %w", err)
		}
		resolvedIPs = ips
		dnsStatus = "resolved"
	}

	if tlsMode == TLSModeCustom {
		if opts.CertPath == "" || opts.KeyPath == "" {
			return nil, errors.New("custom TLS mode requires both --cert-path and --key-path")
		}
		if _, err := os.Stat(opts.CertPath); err != nil {
			return nil, fmt.Errorf("certificate file not found (%s): %w", opts.CertPath, err)
		}
		if _, err := os.Stat(opts.KeyPath); err != nil {
			return nil, fmt.Errorf("private key file not found (%s): %w", opts.KeyPath, err)
		}
	}

	var serverURL string
	var mcpEndpoint string
	if enableTLS {
		serverURL = fmt.Sprintf("https://%s", domain)
		if opts.HTTPSPort != 443 && opts.HTTPSPort != 0 && domain == "localhost" {
			serverURL = fmt.Sprintf("https://%s:%d", domain, opts.HTTPSPort)
		}
	} else {
		serverURL = fmt.Sprintf("http://%s", domain)
		if opts.HTTPPort != 80 && opts.HTTPPort != 0 {
			serverURL = fmt.Sprintf("http://%s:%d", domain, opts.HTTPPort)
		}
	}
	mcpEndpoint = fmt.Sprintf("%s/mcp", strings.TrimRight(serverURL, "/"))

	cfg := &RuntimeConfig{
		Domain:            domain,
		HTTPPort:          opts.HTTPPort,
		HTTPSPort:         opts.HTTPSPort,
		EnableTLS:         enableTLS,
		MCPEndpoint:       mcpEndpoint,
		ServerURL:         serverURL,
		ConfiguredAt:      time.Now().UTC(),
		DNSStatus:         dnsStatus,
		ResolvedIPs:       resolvedIPs,
		TLSMode:           tlsMode,
		CertPath:          opts.CertPath,
		KeyPath:           opts.KeyPath,
		BootstrapComplete: true,
	}

	if err := SaveRuntimeConfig(cfg); err != nil {
		return nil, fmt.Errorf("failed to save runtime config: %w", err)
	}

	envPath := opts.EnvFile
	if envPath == "" {
		envPath = os.Getenv("GEN_HUB_ENV_FILE")
	}
	if envPath == "" {
		envPath = DefaultRuntimeEnvFile
	}
	if err := WriteRuntimeEnvFile(envPath, cfg); err != nil {
		fallbackEnv := filepath.Join(xdg.ConfigHome, "gen-hub", "gen-hub.env")
		_ = WriteRuntimeEnvFile(fallbackEnv, cfg)
	}

	return cfg, nil
}

// SaveRuntimeConfig saves configuration to XDG config storage.
func SaveRuntimeConfig(cfg *RuntimeConfig) error {
	path, err := xdg.ConfigFile(DefaultRuntimeConfigRelPath)
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

// LoadRuntimeConfig loads persisted runtime configuration.
func LoadRuntimeConfig() (*RuntimeConfig, error) {
	path := filepath.Join(xdg.ConfigHome, DefaultRuntimeConfigRelPath)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg RuntimeConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// WriteRuntimeEnvFile persists runtime environment variables with strict permissions (0600).
func WriteRuntimeEnvFile(path string, cfg *RuntimeConfig) error {
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
	if cfg.HTTPPort > 0 {
		sb.WriteString(fmt.Sprintf("GEN_HUB_HTTP_PORT=%d\n", cfg.HTTPPort))
	}
	if cfg.HTTPSPort > 0 {
		sb.WriteString(fmt.Sprintf("GEN_HUB_HTTPS_PORT=%d\n", cfg.HTTPSPort))
	}
	if cfg.CertPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_CERT_PATH=%s\n", cfg.CertPath))
	}
	if cfg.KeyPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_KEY_PATH=%s\n", cfg.KeyPath))
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(sb.String()), 0o600)
}

// ParseURLHost extracts host and normalized URL.
func ParseURLHost(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	return u.Host, nil
}
