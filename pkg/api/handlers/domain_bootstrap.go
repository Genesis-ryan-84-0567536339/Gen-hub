package handlers

import (
	"errors"
	"os"
	"strings"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/domain"
)

type DomainBootstrapHandler struct {
	serverURL         string
	loadRuntimeConfig func() (*domain.RuntimeConfig, error)
	checkDNS          func(api.Context, string) ([]string, error)
}

type DomainStatusResponse struct {
	Domain            string   `json:"domain"`
	ServerURL         string   `json:"serverURL"`
	MCPEndpoint       string   `json:"mcpEndpoint"`
	TLSActive         bool     `json:"tlsActive"`
	TLSConfigured     bool     `json:"tlsConfigured"`
	TLSMode           string   `json:"tlsMode"`
	DNSStatus         string   `json:"dnsStatus"`
	ResolvedIPs       []string `json:"resolvedIPs,omitempty"`
	State             string   `json:"state"`
	Error             string   `json:"error,omitempty"`
	ConfigComplete    bool     `json:"configComplete"`
	BootstrapComplete bool     `json:"bootstrapComplete"`
}

type CheckDNSRequest struct {
	Domain string `json:"domain"`
}

type CheckDNSResponse struct {
	Domain      string   `json:"domain"`
	Valid       bool     `json:"valid"`
	ResolvedIPs []string `json:"resolvedIPs,omitempty"`
	Error       string   `json:"error,omitempty"`
}

func NewDomainBootstrapHandler(serverURL string) *DomainBootstrapHandler {
	return &DomainBootstrapHandler{
		serverURL:         serverURL,
		loadRuntimeConfig: domain.LoadRuntimeConfig,
		checkDNS: func(req api.Context, domainName string) ([]string, error) {
			return domain.CheckDNSReadiness(req.Context(), domainName)
		},
	}
}

// GetStatus returns the current runtime domain configuration neutrally.
func (h *DomainBootstrapHandler) GetStatus(req api.Context) error {
	cfg, err := h.loadRuntimeConfig()
	if err == nil && cfg != nil && cfg.Domain != "" {
		state := cfg.State
		if state == "" {
			if cfg.EnableTLS {
				state = domain.BootstrapStateTLSPending
			} else {
				state = domain.BootstrapStateConfigured
			}
		}
		return req.Write(DomainStatusResponse{
			Domain:            cfg.Domain,
			ServerURL:         cfg.ServerURL,
			MCPEndpoint:       cfg.MCPEndpoint,
			TLSActive:         requestUsesHTTPS(req),
			TLSConfigured:     cfg.EnableTLS,
			TLSMode:           cfg.TLSMode,
			DNSStatus:         cfg.DNSStatus,
			ResolvedIPs:       cfg.ResolvedIPs,
			State:             state,
			Error:             cfg.Error,
			ConfigComplete:    cfg.ConfigComplete,
			BootstrapComplete: cfg.BootstrapComplete,
		})
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return req.Write(DomainStatusResponse{
			TLSActive:      requestUsesHTTPS(req),
			State:          domain.BootstrapStateError,
			DNSStatus:      "unknown",
			Error:          "Không đọc được cấu hình domain đã lưu: " + err.Error(),
			ConfigComplete: false,
		})
	}

	// The configured server URL can help the operator reach the current process,
	// but it is not persisted first-run state.
	serverURL := strings.TrimRight(h.serverURL, "/")
	var mcpEndpoint string
	if serverURL != "" {
		mcpEndpoint = serverURL + "/mcp"
	}

	return req.Write(DomainStatusResponse{
		ServerURL:         serverURL,
		MCPEndpoint:       mcpEndpoint,
		TLSActive:         requestUsesHTTPS(req),
		TLSConfigured:     strings.HasPrefix(serverURL, "https://"),
		State:             domain.BootstrapStateUnconfigured,
		DNSStatus:         "unchecked",
		ConfigComplete:    false,
		BootstrapComplete: false,
	})
}

// CheckDNS validates domain syntax and performs live DNS lookup without modifying state.
func (h *DomainBootstrapHandler) CheckDNS(req api.Context) error {
	var body CheckDNSRequest
	if err := req.Read(&body); err != nil {
		return err
	}

	domainName, err := domain.ValidateDomainSyntax(body.Domain)
	if err != nil {
		return req.Write(CheckDNSResponse{
			Domain: body.Domain,
			Valid:  false,
			Error:  err.Error(),
		})
	}

	ips, err := h.checkDNS(req, domainName)
	if err != nil {
		return req.Write(CheckDNSResponse{
			Domain: domainName,
			Valid:  false,
			Error:  err.Error(),
		})
	}

	return req.Write(CheckDNSResponse{
		Domain:      domainName,
		Valid:       true,
		ResolvedIPs: ips,
	})
}

func requestUsesHTTPS(req api.Context) bool {
	if req.TLS != nil {
		return true
	}
	forwardedProto, _, _ := strings.Cut(req.Request.Header.Get("X-Forwarded-Proto"), ",")
	return strings.EqualFold(strings.TrimSpace(forwardedProto), "https")
}
