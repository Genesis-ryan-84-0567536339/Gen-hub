package handlers

import (
	"testing"

	"github.com/obot-platform/obot/pkg/domain"
)

func TestDomainBootstrapHandlerLogic(t *testing.T) {
	norm, err := domain.ValidateDomainSyntax("mcp.example.com")
	if err != nil {
		t.Fatalf("expected valid domain, got: %v", err)
	}
	if norm != "mcp.example.com" {
		t.Errorf("expected mcp.example.com, got %s", norm)
	}
}
