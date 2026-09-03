package handlers

import (
	"fmt"
	"net/http"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/policy"
)

type GlobalPolicyHandler struct {
	policyManager *policy.PolicyManager
}

func NewGlobalPolicyHandler() *GlobalPolicyHandler {
	return &GlobalPolicyHandler{
		policyManager: policy.GetDefaultManager(),
	}
}

// GetGlobalPolicy returns the full authoritative global publish policy.
func (h *GlobalPolicyHandler) GetGlobalPolicy(req api.Context) error {
	pol := h.policyManager.GetPolicy()
	return req.Write(pol)
}

// UpdateMCPPolicyInput represents the payload to update an MCP or tool policy.
type UpdateMCPPolicyInput struct {
	MCPName     string `json:"mcpName"`
	ToolName    string `json:"toolName,omitempty"`
	Enabled     *bool  `json:"enabled,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Description string `json:"description,omitempty"`
}

// UpdateGlobalPolicy updates global policy for an MCP or tool.
func (h *GlobalPolicyHandler) UpdateGlobalPolicy(req api.Context) error {
	if !req.UserIsAdmin() {
		return types.NewErrForbidden("only administrators can modify global publish policy")
	}

	var input UpdateMCPPolicyInput
	if err := req.Read(&input); err != nil {
		return types.NewErrBadRequest("invalid request body: %v", err)
	}

	if input.MCPName == "" {
		return types.NewErrBadRequest("mcpName is required")
	}

	if input.ToolName != "" {
		// Tool-level policy update
		if input.Enabled == nil {
			return types.NewErrBadRequest("enabled status is required when toolName is provided")
		}
		if err := h.policyManager.SetToolEnabled(input.MCPName, input.ToolName, *input.Enabled); err != nil {
			return fmt.Errorf("set tool enabled: %w", err)
		}
	} else if input.Enabled != nil {
		// MCP-level policy update
		if err := h.policyManager.SetMCPEnabled(input.MCPName, *input.Enabled); err != nil {
			return fmt.Errorf("set mcp enabled: %w", err)
		}
	}

	if err := h.policyManager.Save(); err != nil {
		return fmt.Errorf("save global policy: %w", err)
	}

	return req.Write(h.policyManager.GetPolicy())
}
