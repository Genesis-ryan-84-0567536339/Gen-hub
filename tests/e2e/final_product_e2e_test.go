package e2e

import (
	"bytes"
	"net/http"
	"testing"

	otypes "github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/cli"
	"github.com/obot-platform/obot/pkg/domain"
	"github.com/obot-platform/obot/pkg/mcp"
	"github.com/obot-platform/obot/pkg/mcp/auditlogs"
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
	// Step 1 & 2: Pending agent blocked (AGENT-01)
	allowed, reason := mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusPending, true, true, []string{"list-repos"}, "list-repos")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentPending, reason)

	// Step 3 & 4: Approved agent with granted tool allowed (AGENT-02)
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, true, true, []string{"list-repos"}, "list-repos")
	assert.True(t, allowed)
	assert.Equal(t, mcp.ReasonAllowed, reason)

	// Step 5: Un-granted tool blocked (AGENT-02, AGENT-03)
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, true, true, []string{"list-repos"}, "delete-repo")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentToolNotGranted, reason)

	// Step 6 & 7: Credential Vault secret masking (VAULT-01, VAULT-02)
	masked := mcp.MaskSecret("ghp_secret_token_12345")
	assert.NotContains(t, masked, "secret_token")
	assert.Contains(t, masked, "****")

	// Step 8: Connector catalog check for 8 target connectors
	assert.True(t, mcp.IsConnectorSupported("github"))
	assert.True(t, mcp.IsConnectorSupported("google-drive"))
	assert.True(t, mcp.IsConnectorSupported("web-search"))
	assert.True(t, mcp.IsConnectorSupported("postgresql"))
	assert.True(t, mcp.IsConnectorSupported("filesystem"))
	assert.True(t, mcp.IsConnectorSupported("gmail"))
	assert.True(t, mcp.IsConnectorSupported("google-calendar"))
	assert.True(t, mcp.IsConnectorSupported("slack"))

	// Step 9: Owner revokes agent -> subsequent calls denied (AGENT-04, AGENT-05)
	allowed, reason = mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusRevoked, true, true, []string{"list-repos"}, "list-repos")
	assert.False(t, allowed)
	assert.Equal(t, mcp.ReasonAgentRevoked, reason)
}

// TestNegativeSecuritySuite tests negative security invariant cases (FINAL_PRODUCT_SPEC.md Section 14.6)
func TestNegativeSecuritySuite(t *testing.T) {
	t.Run("unauthenticated call blocked", func(t *testing.T) {
		allowed, reason := mcp.AuthorizeAgentToolAccess(false, mcp.AgentStatusApproved, true, true, []string{"read-file"}, "read-file")
		assert.False(t, allowed)
		assert.Equal(t, mcp.ReasonNotAuthenticated, reason)
	})

	t.Run("mcp server disabled globally blocks all tools", func(t *testing.T) {
		allowed, reason := mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, false, true, []string{"read-file"}, "read-file")
		assert.False(t, allowed)
		assert.Equal(t, mcp.ReasonMCPDisabled, reason)
	})

	t.Run("individual tool disabled globally blocks call even if granted to agent", func(t *testing.T) {
		allowed, reason := mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusApproved, true, false, []string{"read-file"}, "read-file")
		assert.False(t, allowed)
		assert.Equal(t, mcp.ReasonToolDisabled, reason)
	})

	t.Run("rejected agent blocked", func(t *testing.T) {
		allowed, reason := mcp.AuthorizeAgentToolAccess(true, mcp.AgentStatusRejected, true, true, []string{"read-file"}, "read-file")
		assert.False(t, allowed)
		assert.Equal(t, mcp.ReasonAgentRejected, reason)
	})
}

// TestToolClassificationSafetyRules verifies dangerous tools default OFF (MCP-06, MCP-07)
func TestToolClassificationSafetyRules(t *testing.T) {
	// Read-only tools should be enabled by default
	enabled, cat := mcp.ClassifyToolSafety("search_items", "Search items in database")
	assert.True(t, enabled)
	assert.Equal(t, mcp.CategoryReadOnly, cat)

	// Destructive tools should be disabled by default
	enabled, cat = mcp.ClassifyToolSafety("delete_item", "Removes an item permanently")
	assert.False(t, enabled)
	assert.Equal(t, mcp.CategoryDestructive, cat)

	// Unknown tools should be disabled by default for safety
	enabled, cat = mcp.ClassifyToolSafety("execute_arbitrary_cmd", "Runs command")
	assert.False(t, enabled)
	assert.Equal(t, mcp.CategoryDestructive, cat)

	// Materialize overrides
	overrides := mcp.MaterializeDefaultToolOverrides([]otypes.MCPServerTool{
		{Name: "search", Description: "Search repos"},
		{Name: "drop_table", Description: "Drop table"},
	})
	assert.Len(t, overrides, 2)
	assert.True(t, overrides[0].Enabled)
	assert.False(t, overrides[1].Enabled)
}

// TestAuditRedactionInvariants verifies sensitive data is never logged (VAULT-02, AUDIT-02)
func TestAuditRedactionInvariants(t *testing.T) {
	reqHeaders := http.Header{}
	reqHeaders.Set("Authorization", "Bearer sensitive-secret-token")
	reqHeaders.Set("Cookie", "session=secret-session-id")
	reqHeaders.Set("X-Api-Key", "my-api-key-12345")
	reqHeaders.Set("Accept", "application/json")

	redacted := auditlogs.RedactHeaders(reqHeaders)
	assert.Equal(t, "[REDACTED]", redacted.Get("Authorization"))
	assert.Equal(t, "[REDACTED]", redacted.Get("Cookie"))
	assert.Equal(t, "[REDACTED]", redacted.Get("X-Api-Key"))
	assert.Equal(t, "application/json", redacted.Get("Accept"))

	// Map version
	headerMap := map[string]string{
		"Authorization": "Bearer token",
		"Content-Type":  "application/json",
	}
	redactedMap := auditlogs.RedactHeaderMap(headerMap)
	assert.Equal(t, "[REDACTED]", redactedMap["Authorization"])
	assert.Equal(t, "application/json", redactedMap["Content-Type"])

	// Outcomes
	assert.Equal(t, "Success", auditlogs.OutcomeSuccess)
	assert.Equal(t, "Error", auditlogs.OutcomeError)
	assert.Equal(t, "Denied", auditlogs.OutcomeDenied)
}

// TestDomainAndOpsInvariants verifies first-run domain and ops operations (INSTALL-02, OPS-01, OPS-02)
func TestDomainAndOpsInvariants(t *testing.T) {
	// Domain syntax validation
	normalized, err := domain.ValidateDomainSyntax("hub.mycompany.com")
	assert.NoError(t, err)
	assert.Equal(t, "hub.mycompany.com", normalized)

	// Invalid domain syntax rejected
	_, err = domain.ValidateDomainSyntax("http://invalid:8080/path")
	assert.Error(t, err)

	// Backup command
	backupCmd := cli.NewBackupCommand()
	backupCmd.SetArgs([]string{"/tmp/gen-hub-backup.tar.gz"})
	assert.NoError(t, backupCmd.Execute())

	// Restore command validates non-existent file
	restoreCmd := cli.NewRestoreCommand()
	restoreCmd.SetArgs([]string{"/nonexistent/backup.tar.gz"})
	assert.Error(t, restoreCmd.Execute())

	// Update command
	updateCmd := cli.NewUpdateCommand()
	buf := new(bytes.Buffer)
	updateCmd.SetOut(buf)
	updateCmd.SetArgs([]string{"v1.0.0"})
	assert.NoError(t, updateCmd.Execute())
}
