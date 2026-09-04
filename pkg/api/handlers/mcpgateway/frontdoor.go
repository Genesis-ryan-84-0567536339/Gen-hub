package mcpgateway

import (
	"errors"
	"net/http"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/mcp"
	"github.com/obot-platform/obot/pkg/principal"
	"github.com/obot-platform/obot/pkg/system"
)

// ResolveFrontDoorTargetMCPServer finds the one marked Composite Hub owned by the caller.
func ResolveFrontDoorTargetMCPServer(req api.Context) (string, error) {
	server, err := mcp.ResolveFrontDoorComposite(req.Context(), req.Storage, system.DefaultNamespace, principal.ResourceOwnerID(req.User))
	if err != nil {
		return "", err
	}
	return server.Name, nil
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
		if errors.Is(err, mcp.ErrFrontDoorCompositeNotFound) ||
			errors.Is(err, mcp.ErrFrontDoorCompositeConflict) ||
			errors.Is(err, mcp.ErrFrontDoorCompositeInvalid) {
			http.Error(req.ResponseWriter, err.Error(), http.StatusServiceUnavailable)
			return nil
		}
		http.Error(req.ResponseWriter, "Failed to resolve Composite Hub: "+err.Error(), http.StatusInternalServerError)
		return nil
	}

	// Re-route request context to Proxy with resolved mcp_id
	req.SetPathValue("mcp_id", targetMCPServerID)

	// Preserve rest path if any
	rest := req.PathValue("rest")
	if rest != "" {
		req.SetPathValue("rest", rest)
	}

	if h.frontDoorProxy != nil {
		return h.frontDoorProxy(req)
	}
	return h.Proxy(req)
}
