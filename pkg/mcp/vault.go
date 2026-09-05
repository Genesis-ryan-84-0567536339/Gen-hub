package mcp

import (
	"slices"
	"strings"
)

var (
	// SupportedConnectors lists the 8 target connectors required for Gen Hub v1 (FINAL_PRODUCT_SPEC.md Section 9)
	SupportedConnectors = []string{
		"github",
		"google-drive",
		"web-search",
		"postgresql",
		"filesystem",
		"gmail",
		"google-calendar",
		"slack",
	}
)

// IsConnectorSupported returns true if the connector is in the official Gen Hub v1 target catalog.
func IsConnectorSupported(connectorID string) bool {
	return slices.Contains(SupportedConnectors, strings.ToLower(connectorID))
}

// MaskSecret masks sensitive values for Vault UI and API responses (VAULT-02).
// Plaintext secrets are never returned to client or logged.
func MaskSecret(secret string) string {
	if len(secret) == 0 {
		return ""
	}
	if len(secret) <= 4 {
		return "****"
	}
	return secret[:2] + "****" + secret[len(secret)-2:]
}
