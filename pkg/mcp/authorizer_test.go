package mcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAuthorizeAgentToolAccess(t *testing.T) {
	tests := []struct {
		name           string
		authenticated  bool
		agentStatus    AgentStatus
		mcpEnabled     bool
		toolEnabled    bool
		agentGrants    []string
		toolName       string
		expectedAllow  bool
		expectedReason string
	}{
		{
			name:           "unauthenticated request rejected",
			authenticated:  false,
			agentStatus:    AgentStatusApproved,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonNotAuthenticated,
		},
		{
			name:           "pending agent rejected",
			authenticated:  true,
			agentStatus:    AgentStatusPending,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonAgentPending,
		},
		{
			name:           "rejected agent blocked",
			authenticated:  true,
			agentStatus:    AgentStatusRejected,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonAgentRejected,
		},
		{
			name:           "revoked agent blocked",
			authenticated:  true,
			agentStatus:    AgentStatusRevoked,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonAgentRevoked,
		},
		{
			name:           "disabled MCP server blocked",
			authenticated:  true,
			agentStatus:    AgentStatusApproved,
			mcpEnabled:     false,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonMCPDisabled,
		},
		{
			name:           "disabled tool blocked",
			authenticated:  true,
			agentStatus:    AgentStatusApproved,
			mcpEnabled:     true,
			toolEnabled:    false,
			agentGrants:    []string{"read-repo"},
			toolName:       "read-repo",
			expectedAllow:  false,
			expectedReason: ReasonToolDisabled,
		},
		{
			name:           "un-granted tool blocked",
			authenticated:  true,
			agentStatus:    AgentStatusApproved,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo"},
			toolName:       "write-repo",
			expectedAllow:  false,
			expectedReason: ReasonAgentToolNotGranted,
		},
		{
			name:           "valid approved agent with granted tool allowed",
			authenticated:  true,
			agentStatus:    AgentStatusApproved,
			mcpEnabled:     true,
			toolEnabled:    true,
			agentGrants:    []string{"read-repo", "write-repo"},
			toolName:       "read-repo",
			expectedAllow:  true,
			expectedReason: ReasonAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			allowed, reason := AuthorizeAgentToolAccess(
				tt.authenticated,
				tt.agentStatus,
				tt.mcpEnabled,
				tt.toolEnabled,
				tt.agentGrants,
				tt.toolName,
			)
			assert.Equal(t, tt.expectedAllow, allowed, "Allowed mismatch")
			assert.Equal(t, tt.expectedReason, reason, "Reason mismatch")
		})
	}
}
