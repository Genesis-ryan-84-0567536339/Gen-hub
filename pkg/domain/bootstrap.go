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
	"strconv"
	"strings"
	"time"

	"github.com/adrg/xdg"
)

const (
	DefaultRuntimeConfigRelPath = "gen-hub/runtime-config.json"
	DefaultRuntimeEnvFile       = "/data/gen-hub.env"
	RuntimeConfigFileEnv        = "GEN_HUB_RUNTIME_CONFIG_FILE"

	// TLSMode constants
	TLSModeNone        = "none"
	TLSModeLetsEncrypt = "letsencrypt"
	TLSModeCustom      = "custom"

	// Bootstrap state constants describe only the first-run infrastructure state.
	// The ready state is reserved for the later product-level readiness check.
	BootstrapStateUnconfigured = "unconfigured"
	BootstrapStateDNSNotReady  = "dns_not_ready"
	BootstrapStateTLSPending   = "tls_pending"
	BootstrapStateConfigured   = "configured"
	BootstrapStateReady        = "ready"
	BootstrapStateError        = "error"
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
	State             string    `json:"state"`
	Error             string    `json:"error,omitempty"`
	EnvFile           string    `json:"envFile,omitempty"`
	ConfigComplete    bool      `json:"configComplete"`
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
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
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
	return executeBootstrap(ctx, opts, CheckDNSReadiness)
}

func executeBootstrap(ctx context.Context, opts BootstrapOptions, checkDNS func(context.Context, string) ([]string, error)) (*RuntimeConfig, error) {
	domain, err := ValidateDomainSyntax(opts.Domain)
	if err != nil {
		return nil, fmt.Errorf("domain validation error: %w", err)
	}

	tlsMode, enableTLS, err := NormalizeTLSMode(opts.TLSMode, opts.EnableTLS)
	if err != nil {
		return nil, err
	}
	if err := validatePort("http-port", opts.HTTPPort); err != nil {
		return nil, err
	}
	if err := validatePort("https-port", opts.HTTPSPort); err != nil {
		return nil, err
	}

	envPath := opts.EnvFile
	if envPath == "" {
		envPath = os.Getenv("GEN_HUB_ENV_FILE")
	}
	if envPath == "" {
		envPath = DefaultRuntimeEnvFile
	}

	cfg := &RuntimeConfig{
		Domain:       domain,
		HTTPPort:     opts.HTTPPort,
		HTTPSPort:    opts.HTTPSPort,
		EnableTLS:    enableTLS,
		ConfiguredAt: time.Now().UTC(),
		DNSStatus:    "checking",
		TLSMode:      tlsMode,
		CertPath:     opts.CertPath,
		KeyPath:      opts.KeyPath,
		State:        BootstrapStateConfigured,
		EnvFile:      envPath,
	}

	if existing, loadErr := LoadRuntimeConfig(); loadErr == nil && sameBootstrapInput(existing, cfg) {
		cfg.ConfiguredAt = existing.ConfiguredAt
	}

	var resolvedIPs []string
	dnsStatus := "skipped"
	if !opts.SkipDNS {
		ips, err := checkDNS(ctx, domain)
		if err != nil {
			cfg.DNSStatus = "not_ready"
			cfg.State = BootstrapStateDNSNotReady
			cfg.Error = err.Error()
			if saveErr := SaveRuntimeConfig(cfg); saveErr != nil {
				return nil, errors.Join(fmt.Errorf("DNS readiness check failed: %w", err), fmt.Errorf("failed to persist bootstrap failure: %w", saveErr))
			}
			return nil, fmt.Errorf("DNS readiness check failed: %w", err)
		}
		resolvedIPs = ips
		dnsStatus = "resolved"
	}

	if tlsMode == TLSModeCustom {
		if opts.CertPath == "" || opts.KeyPath == "" {
			return nil, persistBootstrapError(cfg, errors.New("custom TLS mode requires both --cert-path and --key-path"))
		}
		if _, err := os.Stat(opts.CertPath); err != nil {
			return nil, persistBootstrapError(cfg, fmt.Errorf("certificate file not found (%s): %w", opts.CertPath, err))
		}
		if _, err := os.Stat(opts.KeyPath); err != nil {
			return nil, persistBootstrapError(cfg, fmt.Errorf("private key file not found (%s): %w", opts.KeyPath, err))
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

	cfg.MCPEndpoint = mcpEndpoint
	cfg.ServerURL = serverURL
	cfg.DNSStatus = dnsStatus
	cfg.ResolvedIPs = resolvedIPs
	cfg.ConfigComplete = true
	// Domain configuration alone cannot prove that the app, HTTPS, owner setup,
	// and designated Composite Hub are ready.
	cfg.BootstrapComplete = false
	if enableTLS {
		cfg.State = BootstrapStateTLSPending
	}

	if err := WriteRuntimeEnvFile(envPath, cfg); err != nil {
		return nil, persistBootstrapError(cfg, fmt.Errorf("failed to write runtime environment file %s: %w", envPath, err))
	}
	if err := SaveRuntimeConfig(cfg); err != nil {
		return nil, fmt.Errorf("failed to save runtime config: %w", err)
	}

	return cfg, nil
}

func validatePort(name string, port int) error {
	if port < 0 || port > 65535 {
		return fmt.Errorf("invalid %s %d: must be between 0 and 65535", name, port)
	}
	return nil
}

func sameBootstrapInput(left, right *RuntimeConfig) bool {
	return left != nil && right != nil &&
		left.Domain == right.Domain &&
		left.HTTPPort == right.HTTPPort &&
		left.HTTPSPort == right.HTTPSPort &&
		left.EnableTLS == right.EnableTLS &&
		left.TLSMode == right.TLSMode &&
		left.CertPath == right.CertPath &&
		left.KeyPath == right.KeyPath &&
		left.EnvFile == right.EnvFile
}

func persistBootstrapError(cfg *RuntimeConfig, bootstrapErr error) error {
	cfg.State = BootstrapStateError
	cfg.Error = bootstrapErr.Error()
	cfg.ConfigComplete = false
	cfg.BootstrapComplete = false
	if err := SaveRuntimeConfig(cfg); err != nil {
		return errors.Join(bootstrapErr, fmt.Errorf("failed to persist bootstrap failure: %w", err))
	}
	return bootstrapErr
}

// SaveRuntimeConfig saves configuration to XDG config storage.
func SaveRuntimeConfig(cfg *RuntimeConfig) error {
	path, err := runtimeConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	return writeFileAtomic(path, data, 0o600)
}

// LoadRuntimeConfig loads persisted runtime configuration.
func LoadRuntimeConfig() (*RuntimeConfig, error) {
	path, err := runtimeConfigPath()
	if err != nil {
		return nil, err
	}
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
	fmt.Fprintf(&sb, "# Generated at %s\n\n", cfg.ConfiguredAt.Format(time.RFC3339))
	fmt.Fprintf(&sb, "GEN_HUB_DOMAIN=%s\n", strconv.Quote(cfg.Domain))
	fmt.Fprintf(&sb, "OBOT_SERVER_HOSTNAME=%s\n", strconv.Quote(cfg.ServerURL))
	fmt.Fprintf(&sb, "OBOT_SERVER_UI_HOSTNAME=%s\n", strconv.Quote(cfg.ServerURL))
	fmt.Fprintf(&sb, "GEN_HUB_MCP_ENDPOINT=%s\n", strconv.Quote(cfg.MCPEndpoint))
	fmt.Fprintf(&sb, "GEN_HUB_ENABLE_TLS=%t\n", cfg.EnableTLS)
	fmt.Fprintf(&sb, "GEN_HUB_TLS_MODE=%s\n", cfg.TLSMode)
	if cfg.HTTPPort > 0 {
		fmt.Fprintf(&sb, "GEN_HUB_HTTP_PORT=%d\n", cfg.HTTPPort)
	}
	if cfg.HTTPSPort > 0 {
		fmt.Fprintf(&sb, "GEN_HUB_HTTPS_PORT=%d\n", cfg.HTTPSPort)
	}
	if cfg.CertPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_CERT_PATH=%s\n", strconv.Quote(cfg.CertPath)))
	}
	if cfg.KeyPath != "" {
		sb.WriteString(fmt.Sprintf("GEN_HUB_TLS_KEY_PATH=%s\n", strconv.Quote(cfg.KeyPath)))
	}

	return writeFileAtomic(path, []byte(sb.String()), 0o600)
}

func runtimeConfigPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv(RuntimeConfigFileEnv)); path != "" {
		return filepath.Abs(path)
	}
	return xdg.ConfigFile(DefaultRuntimeConfigRelPath)
}

func writeFileAtomic(path string, data []byte, mode os.FileMode) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("creating directory %s: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("creating temporary file for %s: %w", path, err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}()

	if err = tmp.Chmod(mode); err != nil {
		return fmt.Errorf("setting permissions on temporary file for %s: %w", path, err)
	}
	if _, err = tmp.Write(data); err != nil {
		return fmt.Errorf("writing temporary file for %s: %w", path, err)
	}
	if err = tmp.Sync(); err != nil {
		return fmt.Errorf("syncing temporary file for %s: %w", path, err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("closing temporary file for %s: %w", path, err)
	}
	if err = os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replacing %s: %w", path, err)
	}
	return nil
}

// ParseURLHost extracts host and normalized URL.
func ParseURLHost(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	return u.Host, nil
}
