package mcpgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/mcp"
	"github.com/obot-platform/obot/pkg/storage"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newFrontDoorTestStorage(objects ...kclient.Object) storage.Client {
	return storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithIndex(&v1.MCPServer{}, "spec.userID", func(object kclient.Object) []string {
			server := object.(*v1.MCPServer)
			if server.Spec.UserID == "" {
				return nil
			}
			return []string{server.Spec.UserID}
		}).
		WithObjects(objects...).
		Build())
}

func TestFrontDoorProxyNoCompositeReturns503(t *testing.T) {
	storageClient := newFrontDoorTestStorage()
	handler := &Handler{}

	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "http://hub.example/mcp", nil)

	apiReq := api.Context{
		Request:        httpReq,
		ResponseWriter: rec,
		Storage:        storageClient,
		User:           &kuser.DefaultInfo{Name: "test-user", UID: "user-1", Groups: []string{types.GroupAuthenticated}},
	}

	err := handler.FrontDoorProxy(apiReq)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 Service Unavailable when no composite exists, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestFrontDoorProxyResolvesMarkedCompositeServer(t *testing.T) {
	server1 := &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "composite-unmarked",
			Namespace: "default",
		},
		Spec: v1.MCPServerSpec{
			UserID:   "user-1",
			Template: false,
			Manifest: types.MCPServerManifest{
				Runtime: types.RuntimeComposite,
			},
		},
	}
	server2 := &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "composite-marked",
			Namespace: "default",
			Labels: map[string]string{
				mcp.GenHubFrontDoorLabel: mcp.GenHubFrontDoorLabelValue,
			},
		},
		Spec: v1.MCPServerSpec{
			UserID:   "user-1",
			Template: false,
			Manifest: types.MCPServerManifest{
				Runtime:         types.RuntimeComposite,
				CompositeConfig: &types.CompositeRuntimeConfig{},
			},
		},
	}

	storageClient := newFrontDoorTestStorage(server1, server2)

	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "http://hub.example/mcp", nil)

	apiReq := api.Context{
		Request:        httpReq,
		ResponseWriter: rec,
		Storage:        storageClient,
		User:           &kuser.DefaultInfo{Name: "test-user", UID: "user-1", Groups: []string{types.GroupAuthenticated}},
	}

	targetMCPServerID, err := ResolveFrontDoorTargetMCPServer(apiReq)
	if err != nil {
		t.Fatalf("unexpected error resolving front door composite target: %v", err)
	}

	if targetMCPServerID != "composite-marked" {
		t.Fatalf("expected marked composite server, got: %s", targetMCPServerID)
	}
}

func TestFrontDoorProxyAuthenticatedRoutesToMarkedComposite(t *testing.T) {
	server := &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "composite-marked",
			Namespace: "default",
			Labels: map[string]string{
				mcp.GenHubFrontDoorLabel: mcp.GenHubFrontDoorLabelValue,
			},
		},
		Spec: v1.MCPServerSpec{
			UserID: "user-1",
			Manifest: types.MCPServerManifest{
				Runtime:         types.RuntimeComposite,
				CompositeConfig: &types.CompositeRuntimeConfig{},
			},
		},
	}

	var proxiedID string
	handler := &Handler{frontDoorProxy: func(req api.Context) error {
		proxiedID = req.PathValue("mcp_id")
		req.WriteHeader(http.StatusNoContent)
		return nil
	}}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "https://hub.example/mcp", nil)
	apiReq := api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        newFrontDoorTestStorage(server),
		User:           &kuser.DefaultInfo{Name: "test-user", UID: "user-1", Groups: []string{types.GroupAuthenticated}},
	}

	if err := handler.FrontDoorProxy(apiReq); err != nil {
		t.Fatal(err)
	}
	if proxiedID != server.Name || recorder.Code != http.StatusNoContent {
		t.Fatalf("proxy target/status = %q/%d", proxiedID, recorder.Code)
	}
}

func TestFrontDoorProxyAnonymousUsesFrontDoorMetadata(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "https://hub.example/mcp", nil)
	handler := &Handler{}

	if err := handler.FrontDoorProxy(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		APIBaseURL:     "https://hub.example/api",
		User:           &kuser.DefaultInfo{Name: "anonymous"},
	}); err != nil {
		t.Fatal(err)
	}

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", recorder.Code)
	}
	want := `Bearer realm="Obot MCP Gateway", resource_metadata="https://hub.example/.well-known/oauth-protected-resource/mcp"`
	if got := recorder.Header().Get("WWW-Authenticate"); got != want {
		t.Fatalf("WWW-Authenticate = %q, want %q", got, want)
	}
}
