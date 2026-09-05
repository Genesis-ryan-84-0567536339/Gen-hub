package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/domain"
)

func TestDomainBootstrapGetStatusReturnsPersistedState(t *testing.T) {
	handler := NewDomainBootstrapHandler("http://internal:8080")
	handler.loadRuntimeConfig = func() (*domain.RuntimeConfig, error) {
		return &domain.RuntimeConfig{
			Domain:            "hub.example.com",
			ServerURL:         "https://hub.example.com",
			MCPEndpoint:       "https://hub.example.com/mcp",
			EnableTLS:         true,
			TLSMode:           domain.TLSModeLetsEncrypt,
			DNSStatus:         "resolved",
			ResolvedIPs:       []string{"203.0.113.10"},
			State:             domain.BootstrapStateTLSPending,
			ConfigComplete:    true,
			BootstrapComplete: false,
		}, nil
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/domain/status", nil)
	request.Header.Set("X-Forwarded-Proto", "https")
	if err := handler.GetStatus(api.Context{ResponseWriter: recorder, Request: request}); err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}

	var response DomainStatusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Domain != "hub.example.com" || response.State != domain.BootstrapStateTLSPending {
		t.Fatalf("unexpected status response: %+v", response)
	}
	if !response.TLSActive || !response.TLSConfigured || !response.ConfigComplete {
		t.Fatalf("expected HTTPS request and complete base configuration: %+v", response)
	}
	if response.BootstrapComplete {
		t.Fatal("domain configuration must not claim full product bootstrap completion")
	}
}

func TestDomainBootstrapGetStatusReturnsLoadError(t *testing.T) {
	handler := NewDomainBootstrapHandler("https://runtime.example.com")
	handler.loadRuntimeConfig = func() (*domain.RuntimeConfig, error) {
		return nil, errors.New("invalid persisted JSON")
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/domain/status", nil)
	if err := handler.GetStatus(api.Context{ResponseWriter: recorder, Request: request}); err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}

	var response DomainStatusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.State != domain.BootstrapStateError || response.Error == "" {
		t.Fatalf("non-not-found load errors must be visible, got %+v", response)
	}
	if response.Domain != "" {
		t.Fatalf("unreadable configuration must not invent a persisted domain, got %q", response.Domain)
	}
}

func TestDomainBootstrapCheckDNS(t *testing.T) {
	handler := NewDomainBootstrapHandler("")
	handler.checkDNS = func(_ api.Context, domainName string) ([]string, error) {
		if domainName != "hub.example.com" {
			t.Fatalf("unexpected normalized domain %q", domainName)
		}
		return []string{"203.0.113.10"}, nil
	}
	body, err := json.Marshal(CheckDNSRequest{Domain: "HTTPS://HUB.EXAMPLE.COM/"})
	if err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/domain/check-dns", bytes.NewReader(body))
	if err := handler.CheckDNS(api.Context{ResponseWriter: recorder, Request: request}); err != nil {
		t.Fatalf("CheckDNS failed: %v", err)
	}

	var response CheckDNSResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !response.Valid || response.Domain != "hub.example.com" || len(response.ResolvedIPs) != 1 {
		t.Fatalf("unexpected DNS response: %+v", response)
	}
}

func TestDomainBootstrapHandlerConfigure(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("GEN_HUB_RUNTIME_CONFIG_FILE", filepath.Join(tempDir, "runtime-config.json"))
	t.Setenv("GEN_HUB_ENV_FILE", filepath.Join(tempDir, "gen-hub.env"))

	handler := NewDomainBootstrapHandler("http://hub.local:8080")
	body, err := json.Marshal(ConfigureDomainRequest{
		Domain:    "hub.local",
		HTTPPort:  8080,
		EnableTLS: false,
		SkipDNS:   true,
	})
	if err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/domain/configure", bytes.NewReader(body))
	if err := handler.Configure(api.Context{ResponseWriter: recorder, Request: request}); err != nil {
		t.Fatalf("Configure failed: %v", err)
	}

	var response DomainStatusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Domain != "hub.local" || !response.ConfigComplete {
		t.Fatalf("unexpected Configure response: %+v", response)
	}
}

