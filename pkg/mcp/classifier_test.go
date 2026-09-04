package mcp

import (
	"testing"

	otypes "github.com/obot-platform/obot/apiclient/types"
	"github.com/stretchr/testify/assert"
)

func TestClassifyToolSafety(t *testing.T) {
	tests := []struct {
		name             string
		toolName         string
		description      string
		expectedEnabled  bool
		expectedCategory ToolSafetyCategory
	}{
		{
			name:             "read-only list tool",
			toolName:         "list-repositories",
			description:      "Lists all public repositories",
			expectedEnabled:  true,
			expectedCategory: CategoryReadOnly,
		},
		{
			name:             "read-only search tool",
			toolName:         "search-code",
			description:      "Searches code files",
			expectedEnabled:  true,
			expectedCategory: CategoryReadOnly,
		},
		{
			name:             "destructive delete tool",
			toolName:         "delete-repo",
			description:      "Deletes a repository",
			expectedEnabled:  false,
			expectedCategory: CategoryDestructive,
		},
		{
			name:             "destructive create tool",
			toolName:         "create-issue",
			description:      "Creates a new issue",
			expectedEnabled:  false,
			expectedCategory: CategoryDestructive,
		},
		{
			name:             "destructive update tool",
			toolName:         "update-file",
			description:      "Modifies file content",
			expectedEnabled:  false,
			expectedCategory: CategoryDestructive,
		},
		{
			name:             "unknown unclassified tool",
			toolName:         "zorp-ping",
			description:      "Pings the zorp service",
			expectedEnabled:  false,
			expectedCategory: CategoryUnknown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			enabled, category := ClassifyToolSafety(tt.toolName, tt.description)
			assert.Equal(t, tt.expectedEnabled, enabled, "Enabled status mismatch")
			assert.Equal(t, tt.expectedCategory, category, "Category mismatch")
		})
	}
}

func TestMaterializeDefaultToolOverrides(t *testing.T) {
	tools := []otypes.MCPServerTool{
		{Name: "list-repos", Description: "Lists repos"},
		{Name: "delete-repo", Description: "Deletes repo"},
		{Name: "custom-action", Description: "Custom action"},
	}

	overrides := MaterializeDefaultToolOverrides(tools)
	assert.Len(t, overrides, 3)

	assert.Equal(t, "list-repos", overrides[0].Name)
	assert.True(t, overrides[0].Enabled)

	assert.Equal(t, "delete-repo", overrides[1].Name)
	assert.False(t, overrides[1].Enabled)

	assert.Equal(t, "custom-action", overrides[2].Name)
	assert.False(t, overrides[2].Enabled)
}
