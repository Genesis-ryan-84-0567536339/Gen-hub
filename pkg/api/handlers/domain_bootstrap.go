package handlers

import (
	"strings"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/domain"
)

type DomainBootstrapHandler struct {
	serverURL string
}

func NewDomainBootstrapHandler(serverURL string) *DomainBootstrapHandler {
	return &DomainBootstrapHandler{
		serverURL: serverURL,
	}
}

type DomainStatusResponse struct {
	Domain            string   `json:"domain"`
	ServerURL         string   `json:"serverURL"`
	MCPEndpoint       string   `json:"mcpEndpoint"`
	TLSActive         bool     `json:"tlsActive"`
	DNSStatus         string   `json:"dnsStatus"`
	ResolvedIPs       []string `json:"resolvedIPs,omitempty"`
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

// GetStatus returns the current runtime domain configuration neutrally.
func (h *DomainBootstrapHandler) GetStatus(req api.Context) error {
	cfg, err := domain.LoadRuntimeConfig()
	if err == nil && cfg != nil && cfg.Domain != "" {
		return req.Write(DomainStatusResponse{
			Domain:            cfg.Domain,
			ServerURL:         cfg.ServerURL,
			MCPEndpoint:       cfg.MCPEndpoint,
			TLSActive:         cfg.EnableTLS,
			DNSStatus:         cfg.DNSStatus,
			ResolvedIPs:       cfg.ResolvedIPs,
			BootstrapComplete: cfg.BootstrapComplete,
		})
	}

	// Neutral runtime fallback: do not manufacture fake endpoint if serverURL is empty
	serverURL := strings.TrimRight(h.serverURL, "/")
	var mcpEndpoint string
	var tlsActive bool
	if serverURL != "" {
		tlsActive = strings.HasPrefix(serverURL, "https://")
		mcpEndpoint = serverURL + "/mcp"
	}

	host := req.Request.Host
	return req.Write(DomainStatusResponse{
		Domain:            host,
		ServerURL:         serverURL,
		MCPEndpoint:       mcpEndpoint,
		TLSActive:         tlsActive,
		DNSStatus:         "runtime_default",
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

	ctx := req.Context()
	ips, err := domain.CheckDNSReadiness(ctx, domainName)
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
