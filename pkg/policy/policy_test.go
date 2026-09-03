package policy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestIsDangerousTool(t *testing.T) {
	tests := []struct {
		name        string
		toolName    string
		description string
		wantDanger  bool
	}{
		{
			name:        "read tool",
			toolName:    "get_file",
			description: "Reads a file from repository",
			wantDanger:  false,
		},
		{
			name:        "search tool",
			toolName:    "search_code",
			description: "Searches the codebase for terms",
			wantDanger:  false,
		},
		{
			name:        "delete tool",
			toolName:    "delete_file",
			description: "Removes a file",
			wantDanger:  true,
		},
		{
			name:        "execute command",
			toolName:    "run_shell_exec",
			description: "Runs arbitrary shell commands",
			wantDanger:  true,
		},
		{
			name:        "write operation",
			toolName:    "write_file",
			description: "Overwrites file content",
			wantDanger:  true,
		},
		{
			name:        "drop database table",
			toolName:    "drop_table",
			description: "Drops an SQL table",
			wantDanger:  true,
		},
		{
			name:        "destructive description",
			toolName:    "custom_cleanup",
			description: "Remove permanently all user entries",
			wantDanger:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsDangerousTool(tt.toolName, tt.description)
			if got != tt.wantDanger {
				t.Errorf("IsDangerousTool(%q, %q) = %v, want %v", tt.toolName, tt.description, got, tt.wantDanger)
			}
		})
	}
}

func TestPolicyManagerLifecycleAndDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "global-policy.json")

	pm := NewPolicyManager(policyFile)

	// Sync an MCP with safe and dangerous tools
	tools := []ToolInfo{
		{Name: "list_repos", Description: "List user repositories"},
		{Name: "delete_repo", Description: "Delete a repository permanently"},
		{Name: "create_pull_request", Description: "Create a new pull request"},
	}

	pm.SyncMCP("github", "GitHub", "github-icon", "GitHub Integration", tools)

	// Verify safe tools are default ON, dangerous default OFF
	if !pm.IsToolAllowed("github", "list_repos") {
		t.Errorf("expected list_repos to be enabled by default")
	}
	if pm.IsToolAllowed("github", "delete_repo") {
		t.Errorf("expected delete_repo to be default OFF (dangerous)")
	}
	if pm.IsToolAllowed("github", "create_pull_request") {
		t.Errorf("expected create_pull_request to be default OFF (write verb)")
	}

	// Save policy
	if err := pm.Save(); err != nil {
		t.Fatalf("failed to save policy: %v", err)
	}

	// Verify file mode 0600
	fi, err := os.Stat(policyFile)
	if err != nil {
		t.Fatalf("stat failed: %v", err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("expected file mode 0600, got %o", fi.Mode().Perm())
	}

	// Reload from new manager
	pm2 := NewPolicyManager(policyFile)
	if !pm2.IsToolAllowed("github", "list_repos") {
		t.Errorf("expected list_repos to remain enabled after reload")
	}
	if pm2.IsToolAllowed("github", "delete_repo") {
		t.Errorf("expected delete_repo to remain disabled after reload")
	}

	// Explicitly enable dangerous tool
	if err := pm2.SetToolEnabled("github", "delete_repo", true); err != nil {
		t.Fatalf("failed to enable tool: %v", err)
	}
	if !pm2.IsToolAllowed("github", "delete_repo") {
		t.Errorf("expected delete_repo to be enabled after explicit toggle")
	}

	// Disable entire MCP
	if err := pm2.SetMCPEnabled("github", false); err != nil {
		t.Fatalf("failed to disable MCP: %v", err)
	}
	if pm2.IsMCPAllowed("github") {
		t.Errorf("expected github to be disabled")
	}
	if pm2.IsToolAllowed("github", "list_repos") {
		t.Errorf("expected all tools under disabled MCP to be disallowed")
	}
}

func TestFilterToolsList(t *testing.T) {
	tmpDir := t.TempDir()
	policyFile := filepath.Join(tmpDir, "global-policy.json")
	pm := NewPolicyManager(policyFile)

	inputJSON := `{
		"tools": [
			{"name": "read_record", "description": "Reads a DB record"},
			{"name": "delete_record", "description": "Deletes a DB record"}
		]
	}`

	filtered, err := pm.FilterToolsList("postgres", []byte(inputJSON))
	if err != nil {
		t.Fatalf("FilterToolsList failed: %v", err)
	}

	var output struct {
		Tools []map[string]any `json:"tools"`
	}
	if err := json.Unmarshal(filtered, &output); err != nil {
		t.Fatalf("failed to unmarshal output: %v", err)
	}

	if len(output.Tools) != 1 {
		t.Fatalf("expected 1 tool in filtered output, got %d", len(output.Tools))
	}
	if output.Tools[0]["name"] != "read_record" {
		t.Errorf("expected read_record, got %v", output.Tools[0]["name"])
	}

	// Enforce tool call check
	if err := pm.EnforceToolCall("postgres", "read_record"); err != nil {
		t.Errorf("expected read_record to pass enforcement, got: %v", err)
	}
	if err := pm.EnforceToolCall("postgres", "delete_record"); err == nil {
		t.Errorf("expected delete_record to fail enforcement")
	}
}
