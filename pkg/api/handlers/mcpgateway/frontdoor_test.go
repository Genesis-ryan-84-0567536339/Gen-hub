package mcpgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/storage"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

type frontDoorMockHandler struct {
	Handler
	invokedProxyWithMCPID string
}

func (m *frontDoorMockHandler) Proxy(req api.Context) error {
	m.invokedProxyWithMCPID = req.PathValue("mcp_id")
	req.ResponseWriter.WriteHeader(http.StatusOK)
	return nil
}

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

func TestFrontDoorProxyResolvesDeterministicCompositeServer(t *testing.T) {
	// Create two composite servers with different timestamps
	server1 := &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "composite-2",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour)),
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
			Name:              "composite-1",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-2 * time.Hour)),
		},
		Spec: v1.MCPServerSpec{
			UserID:   "user-1",
			Template: false,
			Manifest: types.MCPServerManifest{
				Runtime: types.RuntimeComposite,
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

	if targetMCPServerID != "composite-1" {
		t.Fatalf("expected deterministic selection of older composite server 'composite-1', got: %s", targetMCPServerID)
	}
}
