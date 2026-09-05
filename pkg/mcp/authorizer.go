package mcp

import (
	"slices"
)

// Reason codes for policy enforcement as specified in FINAL_PRODUCT_SPEC.md Section 13.3
const (
	ReasonNotAuthenticated    = "not_authenticated"
	ReasonAgentPending        = "agent_pending"
	ReasonAgentRejected       = "agent_rejected"
	ReasonAgentRevoked        = "agent_revoked"
	ReasonMCPDisabled         = "mcp_disabled"
	ReasonToolDisabled        = "tool_disabled"
	ReasonAgentToolNotGranted = "agent_tool_not_granted"
	ReasonAllowed             = "allowed"

	AgentStatusPending  AgentStatus = "pending"
	AgentStatusApproved AgentStatus = "approved"
	AgentStatusRejected AgentStatus = "rejected"
	AgentStatusRevoked  AgentStatus = "revoked"
)

// AgentStatus represents the lifecycle state of an agent connection.
type AgentStatus string

// AuthorizeAgentToolAccess checks all four enforcement criteria required by Gen Hub:
// 1. Agent status must be Approved
// 2. Target MCP server must be enabled globally
// 3. Target tool must be enabled globally
// 4. Target tool must be explicitly granted to this agent
func AuthorizeAgentToolAccess(
	authenticated bool,
	agentStatus AgentStatus,
	mcpEnabled bool,
	toolEnabled bool,
	agentGrants []string,
	toolName string,
) (allowed bool, reason string) {
	if !authenticated {
		return false, ReasonNotAuthenticated
	}

	switch agentStatus {
	case AgentStatusPending:
		return false, ReasonAgentPending
	case AgentStatusRejected:
		return false, ReasonAgentRejected
	case AgentStatusRevoked:
		return false, ReasonAgentRevoked
	case AgentStatusApproved:
		// Agent identity is valid
	default:
		return false, ReasonAgentPending
	}

	if !mcpEnabled {
		return false, ReasonMCPDisabled
	}

	if !toolEnabled {
		return false, ReasonToolDisabled
	}

	if !slices.Contains(agentGrants, toolName) {
		return false, ReasonAgentToolNotGranted
	}

	return true, ReasonAllowed
}
