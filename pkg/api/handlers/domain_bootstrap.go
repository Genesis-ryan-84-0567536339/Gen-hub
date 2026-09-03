package handlers

import (
	"context"
	"net"
	"net/http"
	"strings"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/cli"
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

// GetStatus returns the current runtime domain configuration.
func (h *DomainBootstrapHandler) GetStatus(req api.Context) error {
	cfg, err := cli.LoadRuntimeConfig()
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

	// Fallback to serverURL runtime
	serverURL := strings.TrimRight(h.serverURL, "/")
	host := req.Request.Host
	if host == "" {
		host = "localhost:8080"
	}
	tlsActive := strings.HasPrefix(serverURL, "https://")
	mcpEndpoint := serverURL + "/mcp"

	return req.Write(DomainStatusResponse{
		Domain:            host,
		ServerURL:         serverURL,
		MCPEndpoint:       mcpEndpoint,
		TLSActive:         tlsActive,
		DNSStatus:         "runtime_default",
		BootstrapComplete: false,
	})
}

// CheckDNS validates domain syntax and performs live DNS lookup without saving.
func (h *DomainBootstrapHandler) CheckDNS(req api.Context) error {
	var body CheckDNSRequest
	if err := req.Read(&body); err != nil {
		return err
	}

	domain, err := cli.ValidateDomainSyntax(body.Domain)
	if err != nil {
		return req.Write(CheckDNSResponse{
			Domain: body.Domain,
			Valid:  false,
			Error:  err.Error(),
		})
	}

	ctx := req.Context()
	ips, err := cli.CheckDNSReadiness(ctx, domain)
	if err != nil {
		return req.Write(CheckDNSResponse{
			Domain: domain,
			Valid:  false,
			Error:  err.Error(),
		})
	}

	return req.Write(CheckDNSResponse{
		Domain:      domain,
		Valid:       true,
		ResolvedIPs: ips,
	})
}
