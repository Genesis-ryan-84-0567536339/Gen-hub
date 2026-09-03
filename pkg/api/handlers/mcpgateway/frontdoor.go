package mcpgateway

import (
	"net/http"
	"sort"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/principal"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

// ResolveFrontDoorTargetMCPServer deterministically finds the user's active composite MCPServer.
// Returns targetMCPServerID, or error (e.g. types.NewErrNotFound / errNoCompositeFound).
func ResolveFrontDoorTargetMCPServer(req api.Context) (string, error) {
	ownerID := principal.ResourceOwnerID(req.User)

	var serverList v1.MCPServerList
	err := req.List(&serverList, kclient.MatchingFields{
		"spec.userID": ownerID,
	})
	if err != nil {
		return "", err
	}

	var compositeServers []v1.MCPServer
	for _, s := range serverList.Items {
		if s.Spec.Template || s.Spec.CompositeName != "" {
			continue
		}
		if s.Spec.Manifest.Runtime == types.RuntimeComposite {
			compositeServers = append(compositeServers, s)
		}
	}

	if len(compositeServers) == 0 {
		return "", nil
	}

	// Deterministic selection: sort by CreationTimestamp ascending (or Name) so selection is stable
	sort.Slice(compositeServers, func(i, j int) bool {
		if !compositeServers[i].CreationTimestamp.Equal(&compositeServers[j].CreationTimestamp) {
			return compositeServers[i].CreationTimestamp.Before(&compositeServers[j].CreationTimestamp)
		}
		return compositeServers[i].Name < compositeServers[j].Name
	})

	return compositeServers[0].Name, nil
}

// FrontDoorProxy handles direct agent requests to https://<domain>/mcp and https://<domain>/mcp/{rest...}
// It deterministically resolves the user's active composite MCPServer instance.
// If no composite MCPServer instance exists for the user, it returns a clear 503 Service Unavailable
// without falling back to catalog entries or non-composite servers.
func (h *Handler) FrontDoorProxy(req api.Context) error {
	if !req.UserIsAuthenticated() {
		writeMCPAuthRequired(req, false)
		return nil
	}

	targetMCPServerID, err := ResolveFrontDoorTargetMCPServer(req)
	if err != nil {
		http.Error(req.ResponseWriter, "Failed to list MCP servers: "+err.Error(), http.StatusInternalServerError)
		return nil
	}

	if targetMCPServerID == "" {
		http.Error(req.ResponseWriter, "No active Composite MCP server instance found in Gen Hub. Please create or launch a composite MCP server in Gen Hub first.", http.StatusServiceUnavailable)
		return nil
	}

	// Re-route request context to Proxy with resolved mcp_id
	req.SetPathValue("mcp_id", targetMCPServerID)

	// Preserve rest path if any
	rest := req.PathValue("rest")
	if rest != "" {
		req.SetPathValue("rest", rest)
	}

	return h.Proxy(req)
}
