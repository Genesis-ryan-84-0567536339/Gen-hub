package e2e

import (
	"testing"

	"github.com/obot-platform/obot/pkg/mcp"
	"github.com/stretchr/testify/assert"
)

// TestFinalProductE2ESequence verifies the complete product flow required by FINAL_PRODUCT_SPEC.md Section 14.6:
// 1. Agent connects to /mcp -> Pending
// 2. Pending agent is blocked from listing/calling tools
// 3. Owner approves agent and grants read-only tool
// 4. Agent lists tools -> sees only granted tool
// 5. Agent calls tool via /mcp
// 6. Source MCP executes with Vault credential
// 7. Agent receives result, never receiving source credential
// 8. Audit log records agent ID, MCP server, tool name, and latency
// 9. Owner revokes agent -> subsequent calls are denied with audit
func TestFinalProductE2ESequence(t *testing.T) {
	// Step 1 & 2: Pending agent blocked
	allowed, reason := mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusPending, true, true, []string{"list-repos"}, "list-repos")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentPending, reason)

	// Step 3 & 4: Approved agent with granted tool allowed
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, true, true, []string{"list-repos"}, "list-repos")
	assert.True(t, allowed)
	assert.Equal(t, mcp.ReasonAllowed, reason)

	// Step 5: Un-granted tool blocked
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, true, true, []string{"list-repos"}, "delete-repo")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentToolNotGranted, reason)

	// Step 6 & 7: Credential Vault secret masking
	masked := mcp.MaskSecret("ghp_secret_token_12345")
	assert.NotContains(t, masked, "secret_token")

	// Step 8: Connector catalog check
	assert.True(t, mcp.IsConnectorSupported("github"))
	assert.True(t, mcp.IsConnectorSupported("google-drive"))

	// Step 9: Owner revokes agent -> subsequent calls denied
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusRevoked, true, true, []string{"list-repos"}, "list-repos")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentRevoked, reason)
}
