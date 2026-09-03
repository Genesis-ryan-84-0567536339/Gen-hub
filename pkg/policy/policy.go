package policy

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/adrg/xdg"
)

const (
	DefaultGlobalPolicyRelPath = "gen-hub/global-tool-policy.json"
	DefaultGlobalPolicyEnvFile = "/data/global-tool-policy.json"
)

// DangerousVerbs lists prefixes, words, and tokens that classify a tool as destructive / dangerous.
var DangerousVerbs = []string{
	"delete",
	"destroy",
	"remove",
	"drop",
	"erase",
	"purge",
	"truncate",
	"kill",
	"terminate",
	"execute",
	"exec",
	"run_command",
	"write",
	"create",
	"update",
	"patch",
	"modify",
	"put",
	"post",
	"send",
	"publish",
	"deploy",
	"install",
	"uninstall",
	"upload",
	"format",
	"wipe",
	"reset",
}

// ToolPolicy represents the global policy state for an individual tool.
type ToolPolicy struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MCPName     string `json:"mcpName"`
	Enabled     bool   `json:"enabled"`
	Dangerous   bool   `json:"dangerous"`
	Reason      string `json:"reason,omitempty"`
}

// MCPPolicy represents the global policy state for an MCP server.
type MCPPolicy struct {
	Name        string                `json:"name"`
	DisplayName string                `json:"displayName,omitempty"`
	Icon        string                `json:"icon,omitempty"`
	Description string                `json:"description,omitempty"`
	Enabled     bool                  `json:"enabled"`
	Tools       map[string]ToolPolicy `json:"tools"`
}

// GlobalPublishPolicy is the persistent state of all MCPs and tools published in Gen Hub.
type GlobalPublishPolicy struct {
	Version      string               `json:"version"`
	UpdatedAt    time.Time            `json:"updatedAt"`
	MCPs         map[string]MCPPolicy `json:"mcps"`
	CustomConfig map[string]bool      `json:"customConfig,omitempty"`
}

// PolicyManager provides thread-safe access and mutations to the authoritative GlobalPublishPolicy.
type PolicyManager struct {
	mu          sync.RWMutex
	policy      GlobalPublishPolicy
	storagePath string
	initialized bool
}

var (
	defaultManager *PolicyManager
	once           sync.Once
)

// GetDefaultManager returns the singleton instance of PolicyManager.
func GetDefaultManager() *PolicyManager {
	once.Do(func() {
		defaultManager = NewPolicyManager("")
	})
	return defaultManager
}

// NewPolicyManager creates a new PolicyManager instance with the specified persistence path (or defaults).
func NewPolicyManager(storagePath string) *PolicyManager {
	pm := &PolicyManager{
		storagePath: storagePath,
		policy: GlobalPublishPolicy{
			Version: "v1",
			MCPs:    make(map[string]MCPPolicy),
		},
	}
	_ = pm.Load()
	return pm
}

// IsDangerousTool determines if a tool name or description indicates destructive/dangerous actions.
func IsDangerousTool(toolName, description string) bool {
	normName := strings.ToLower(toolName)
	normDesc := strings.ToLower(description)

	// Check words / tokens in tool name
	nameParts := strings.FieldsFunc(normName, func(r rune) bool {
		return r == '_' || r == '-' || r == '.' || r == '/' || r == ':' || r == ' '
	})

	for _, part := range nameParts {
		for _, verb := range DangerousVerbs {
			if part == verb {
				return true
			}
		}
	}

	// Check prefixes or exact substring matches for compound names
	for _, verb := range DangerousVerbs {
		if strings.HasPrefix(normName, verb) {
			return true
		}
		if strings.Contains(normName, "_"+verb) || strings.Contains(normName, "-"+verb) || strings.Contains(normName, "."+verb) {
			return true
		}
	}

	// Check description keywords if explicitly destructive
	if strings.Contains(normDesc, "delete") ||
		strings.Contains(normDesc, "remove permanently") ||
		strings.Contains(normDesc, "execute command") ||
		strings.Contains(normDesc, "destroy") ||
		strings.Contains(normDesc, "drop table") ||
		strings.Contains(normDesc, "write to") ||
		strings.Contains(normDesc, "create new") {
		return true
	}

	return false
}

// ResolvePolicyPath resolves the storage file location.
func (pm *PolicyManager) ResolvePolicyPath() string {
	if pm.storagePath != "" {
		return pm.storagePath
	}
	envPath := os.Getenv("GEN_HUB_GLOBAL_POLICY_FILE")
	if envPath != "" {
		return envPath
	}
	if _, err := os.Stat("/data"); err == nil {
		return DefaultGlobalPolicyEnvFile
	}
	path, err := xdg.ConfigFile(DefaultGlobalPolicyRelPath)
	if err == nil {
		return path
	}
	return filepath.Join(os.TempDir(), "gen-hub-global-policy.json")
}

// Load loads the global publish policy from persistent storage.
func (pm *PolicyManager) Load() error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	path := pm.ResolvePolicyPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			pm.initialized = true
			return nil
		}
		return err
	}

	var pol GlobalPublishPolicy
	if err := json.Unmarshal(data, &pol); err != nil {
		return fmt.Errorf("unmarshal global policy: %w", err)
	}
	if pol.MCPs == nil {
		pol.MCPs = make(map[string]MCPPolicy)
	}
	pm.policy = pol
	pm.initialized = true
	return nil
}

// Save persists the current policy state to disk with 0600 permissions.
func (pm *PolicyManager) Save() error {
	pm.mu.RLock()
	data, err := json.MarshalIndent(pm.policy, "", "  ")
	pm.mu.RUnlock()

	if err != nil {
		return err
	}
	data = append(data, '\n')

	path := pm.ResolvePolicyPath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	return os.WriteFile(path, data, 0o600)
}

// SyncMCP registers or updates discovered MCP and tool definitions according to default policy rules.
func (pm *PolicyManager) SyncMCP(mcpName, displayName, icon, description string, tools []ToolInfo) MCPPolicy {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	existing, exists := pm.policy.MCPs[mcpName]
	if !exists {
		existing = MCPPolicy{
			Name:        mcpName,
			DisplayName: displayName,
			Icon:        icon,
			Description: description,
			Enabled:     true,
			Tools:       make(map[string]ToolPolicy),
		}
	} else {
		if displayName != "" {
			existing.DisplayName = displayName
		}
		if icon != "" {
			existing.Icon = icon
		}
		if description != "" {
			existing.Description = description
		}
		if existing.Tools == nil {
			existing.Tools = make(map[string]ToolPolicy)
		}
	}

	for _, tool := range tools {
		if existingTool, toolExists := existing.Tools[tool.Name]; toolExists {
			if tool.Description != "" {
				existingTool.Description = tool.Description
			}
			existing.Tools[tool.Name] = existingTool
		} else {
			dangerous := IsDangerousTool(tool.Name, tool.Description)
			existing.Tools[tool.Name] = ToolPolicy{
				Name:        tool.Name,
				Description: tool.Description,
				MCPName:     mcpName,
				Enabled:     !dangerous,
				Dangerous:   dangerous,
				Reason:      tool.Reason,
			}
		}
	}

	pm.policy.MCPs[mcpName] = existing
	pm.policy.UpdatedAt = time.Now().UTC()
	return existing
}

// ToolInfo is a lightweight tool descriptor for sync operations.
type ToolInfo struct {
	Name        string
	Description string
	Reason      string
}

// SetMCPEnabled sets the global enabled state for an entire MCP.
func (pm *PolicyManager) SetMCPEnabled(mcpName string, enabled bool) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	mcp, ok := pm.policy.MCPs[mcpName]
	if !ok {
		mcp = MCPPolicy{
			Name:    mcpName,
			Enabled: enabled,
			Tools:   make(map[string]ToolPolicy),
		}
	} else {
		mcp.Enabled = enabled
	}
	pm.policy.MCPs[mcpName] = mcp
	pm.policy.UpdatedAt = time.Now().UTC()
	return nil
}

// SetToolEnabled sets the global enabled state for a specific tool under an MCP.
func (pm *PolicyManager) SetToolEnabled(mcpName, toolName string, enabled bool) error {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	mcp, ok := pm.policy.MCPs[mcpName]
	if !ok {
		mcp = MCPPolicy{
			Name:    mcpName,
			Enabled: true,
			Tools:   make(map[string]ToolPolicy),
		}
	}
	if mcp.Tools == nil {
		mcp.Tools = make(map[string]ToolPolicy)
	}

	t, ok := mcp.Tools[toolName]
	if !ok {
		dangerous := IsDangerousTool(toolName, "")
		t = ToolPolicy{
			Name:      toolName,
			MCPName:   mcpName,
			Enabled:   enabled,
			Dangerous: dangerous,
		}
	} else {
		t.Enabled = enabled
	}

	mcp.Tools[toolName] = t
	pm.policy.MCPs[mcpName] = mcp
	pm.policy.UpdatedAt = time.Now().UTC()
	return nil
}

// IsMCPAllowed checks if an MCP is globally enabled.
func (pm *PolicyManager) IsMCPAllowed(mcpName string) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	mcp, ok := pm.policy.MCPs[mcpName]
	if !ok {
		return true
	}
	return mcp.Enabled
}

// IsToolAllowed returns true if BOTH the parent MCP and the specific tool are globally enabled.
func (pm *PolicyManager) IsToolAllowed(mcpName, toolName string) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if mcp, ok := pm.policy.MCPs[mcpName]; ok {
		if !mcp.Enabled {
			return false
		}
		if tool, toolOk := mcp.Tools[toolName]; toolOk {
			return tool.Enabled
		}
	}

	if IsDangerousTool(toolName, "") {
		return false
	}

	return true
}

// GetPolicy returns a deep copy of the full GlobalPublishPolicy.
func (pm *PolicyManager) GetPolicy() GlobalPublishPolicy {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	copyPolicy := GlobalPublishPolicy{
		Version:   pm.policy.Version,
		UpdatedAt: pm.policy.UpdatedAt,
		MCPs:      make(map[string]MCPPolicy, len(pm.policy.MCPs)),
	}
	for k, v := range pm.policy.MCPs {
		toolsCopy := make(map[string]ToolPolicy, len(v.Tools))
		for tk, tv := range v.Tools {
			toolsCopy[tk] = tv
		}
		v.Tools = toolsCopy
		copyPolicy.MCPs[k] = v
	}
	return copyPolicy
}

// FilterToolsList processes a raw tools/list response JSON payload, removing any globally disabled tools.
func (pm *PolicyManager) FilterToolsList(mcpName string, resultBytes []byte) ([]byte, error) {
	if len(resultBytes) == 0 {
		return resultBytes, nil
	}

	var result struct {
		Tools []map[string]any `json:"tools"`
		Meta  map[string]any   `json:"_meta,omitempty"`
	}

	if err := json.Unmarshal(resultBytes, &result); err != nil {
		return resultBytes, nil
	}

	if result.Tools == nil {
		return resultBytes, nil
	}

	filteredTools := make([]map[string]any, 0, len(result.Tools))
	discoveredTools := make([]ToolInfo, 0, len(result.Tools))

	for _, t := range result.Tools {
		name, _ := t["name"].(string)
		desc, _ := t["description"].(string)
		if name == "" {
			continue
		}

		discoveredTools = append(discoveredTools, ToolInfo{
			Name:        name,
			Description: desc,
		})

		if pm.IsToolAllowed(mcpName, name) {
			filteredTools = append(filteredTools, t)
		}
	}

	go func() {
		pm.SyncMCP(mcpName, "", "", "", discoveredTools)
		_ = pm.Save()
	}()

	result.Tools = filteredTools
	return json.Marshal(result)
}

// EnforceToolCall checks if a tools/call request is allowed by global policy.
func (pm *PolicyManager) EnforceToolCall(mcpName, toolName string) error {
	if !pm.IsMCPAllowed(mcpName) {
		return fmt.Errorf("MCP server %q is disabled by global publish policy", mcpName)
	}
	if !pm.IsToolAllowed(mcpName, toolName) {
		if IsDangerousTool(toolName, "") {
			return fmt.Errorf("tool %q is dangerous and default-disabled by global publish policy (enable in Gen Hub to use)", toolName)
		}
		return fmt.Errorf("tool %q is disabled by global publish policy", toolName)
	}
	return nil
}
