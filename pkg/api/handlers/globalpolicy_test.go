package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/policy"
	kuser "k8s.io/apiserver/pkg/authentication/user"
)

func TestGlobalPolicyHandlerGetAndPut(t *testing.T) {
	handler := NewGlobalPolicyHandler()

	// 1. Non-admin update rejected with 403
	putBody, _ := json.Marshal(UpdateMCPPolicyInput{
		MCPName: "brave-search",
		Enabled: ptrBool(true),
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/global-policy", bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	apiReq := api.Context{
		Request:        req,
		ResponseWriter: rec,
		User:           &kuser.DefaultInfo{Name: "regular-user", UID: "user-regular"},
	}
	err := handler.UpdateGlobalPolicy(apiReq)
	if err == nil {
		t.Fatalf("expected non-admin update to return forbidden error")
	}

	// 2. Admin update succeeds
	recAdmin := httptest.NewRecorder()
	reqAdmin := httptest.NewRequest(http.MethodPut, "/api/global-policy", bytes.NewReader(putBody))
	reqAdmin.Header.Set("Content-Type", "application/json")
	apiReqAdmin := api.Context{
		Request:        reqAdmin,
		ResponseWriter: recAdmin,
		User:           &kuser.DefaultInfo{Name: "admin-user", UID: "user-admin", Groups: []string{"admin"}},
	}
	if err := handler.UpdateGlobalPolicy(apiReqAdmin); err != nil {
		t.Fatalf("admin update failed: %v", err)
	}

	// 3. GET retrieves global policy
	recGet := httptest.NewRecorder()
	reqGet := httptest.NewRequest(http.MethodGet, "/api/global-policy", nil)
	apiReqGet := api.Context{
		Request:        reqGet,
		ResponseWriter: recGet,
		User:           &kuser.DefaultInfo{Name: "admin-user", UID: "user-admin", Groups: []string{"admin"}},
	}
	if err := handler.GetGlobalPolicy(apiReqGet); err != nil {
		t.Fatalf("get global policy failed: %v", err)
	}

	var pol policy.GlobalPublishPolicy
	if err := json.Unmarshal(recGet.Body.Bytes(), &pol); err != nil {
		t.Fatalf("failed to decode policy JSON: %v (body: %s)", err, recGet.Body.String())
	}
	if mcpPol, ok := pol.MCPs["brave-search"]; !ok || !mcpPol.Enabled {
		t.Fatalf("expected brave-search to be enabled in policy, got: %#v", mcpPol)
	}
}

func ptrBool(b bool) *bool {
	return &b
}
