package mcp

import (
	"strings"

	otypes "github.com/obot-platform/obot/apiclient/types"
)

const (
	CategoryReadOnly    ToolSafetyCategory = "read_only"
	CategoryDestructive ToolSafetyCategory = "destructive"
	CategoryUnknown     ToolSafetyCategory = "unknown"
)

// ToolSafetyCategory represents the risk level of an MCP tool.
type ToolSafetyCategory string

// ClassifyToolSafety inspects a tool's name and description to determine if it should be enabled by default.
// Read-only/search tools are enabled by default.
// Destructive, state-modifying, or unknown tools default to disabled for security.
func ClassifyToolSafety(name, description string) (enabled bool, category ToolSafetyCategory) {
	lowerName := strings.ToLower(name)
	lowerDesc := strings.ToLower(description)

	// High-risk action verbs -> Default DISABLED
	destructiveKeywords := []string{
		"create", "delete", "remove", "drop", "destroy", "write", "update", "edit",
		"modify", "put", "post", "patch", "execute", "exec", "run", "send",
		"deploy", "merge", "push", "purge", "clear", "reset", "kill", "terminate",
	}

	for _, kw := range destructiveKeywords {
		if strings.Contains(lowerName, kw) || strings.Contains(lowerDesc, kw) {
			return false, CategoryDestructive
		}
	}

	// Safe read-only action verbs -> Default ENABLED
	readOnlyKeywords := []string{
		"list", "get", "read", "fetch", "search", "find", "describe", "show",
		"view", "inspect", "check", "query", "info", "lookup", "cat",
	}

	for _, kw := range readOnlyKeywords {
		if strings.Contains(lowerName, kw) || strings.Contains(lowerDesc, kw) {
			return true, CategoryReadOnly
		}
	}

	// Unknown or unclassified tools default to DISABLED (fail-closed)
	return false, CategoryUnknown
}

// MaterializeDefaultToolOverrides converts a list of tools into default ToolOverrides based on safety classification.
func MaterializeDefaultToolOverrides(tools []otypes.MCPServerTool) []otypes.ToolOverride {
	overrides := make([]otypes.ToolOverride, 0, len(tools))
	for _, t := range tools {
		enabled, _ := ClassifyToolSafety(t.Name, t.Description)
		overrides = append(overrides, otypes.ToolOverride{
			Name:    t.Name,
			Enabled: enabled,
		})
	}
	return overrides
}
