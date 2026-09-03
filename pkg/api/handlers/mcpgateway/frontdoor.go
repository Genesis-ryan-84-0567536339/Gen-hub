package mcpgateway

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/principal"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"k8s.io/apimachinery/pkg/fields"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

// FrontDoorProxy handles direct requests to https://<domain>/mcp and https://<domain>/mcp/{rest...}
// It dynamically resolves the user's primary composite MCP server or default catalog composite server.
func (h *Handler) FrontDoorProxy(req api.Context) error {
	if !req.UserIsAuthenticated() {
		writeMCPAuthRequired(req, false)
		return nil
	}

	// 1. Check if user already has an active composite MCP server
	var compositeServers v1.MCPServerList
	err := req.List(&compositeServers, &kclient.ListOptions{
		FieldSelector: fields.SelectorFromSet(map[string]string{
			"spec.userID":        principal.ResourceOwnerID(req.User),
			"spec.template":      "false",
			"spec.compositeName": "",
		}),
	})

	var targetMCPServerID string
	if err == nil {
		for _, s := range compositeServers.Items {
			if s.Spec.Manifest.Runtime == types.RuntimeComposite {
				targetMCPServerID = s.Name
				break
			}
		}
	}

	// 2. If none, look for any user MCP server or default catalog entry to route through
	if targetMCPServerID == "" && len(compositeServers.Items) > 0 {
		targetMCPServerID = compositeServers.Items[0].Name
	}

	// 3. If no server exists yet, look up default catalog composite or catalog entries
	if targetMCPServerID == "" {
		var catalogEntries v1.MCPServerCatalogEntryList
		if err := req.List(&catalogEntries); err == nil && len(catalogEntries.Items) > 0 {
			// Find composite entry first
			for _, entry := range catalogEntries.Items {
				if entry.Spec.Manifest.Runtime == types.RuntimeComposite {
					targetMCPServerID = entry.Name
					break
				}
			}
			if targetMCPServerID == "" {
				targetMCPServerID = catalogEntries.Items[0].Name
			}
		}
	}

	if targetMCPServerID == "" {
		http.Error(req.ResponseWriter, "No composite MCP servers or catalog entries available in Gen Hub", http.StatusServiceUnavailable)
		return nil
	}

	// Re-route request context to Proxy with resolved mcp_id
	req.PathValues["mcp_id"] = targetMCPServerID

	// Preserve rest path if any
	rest := req.PathValue("rest")
	if rest != "" {
		req.PathValues["rest"] = rest
	}

	return h.Proxy(req)
}
