package controller

import (
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/mcp"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	"github.com/obot-platform/obot/pkg/system"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestReconcileFrontDoorComposite(t *testing.T) {
	builder := fake.NewClientBuilder().WithScheme(storagescheme.Scheme)
	client := builder.Build()

	// 1. Initial creation
	if err := reconcileFrontDoorComposite(t.Context(), client, "1"); err != nil {
		t.Fatalf("reconcileFrontDoorComposite() initial error = %v", err)
	}

	var server v1.MCPServer
	if err := client.Get(t.Context(), kclient.ObjectKey{
		Name:      mcp.GenHubFrontDoorMCPServerName,
		Namespace: system.DefaultNamespace,
	}, &server); err != nil {
		t.Fatalf("failed to get front-door composite server: %v", err)
	}

	if server.Labels[mcp.GenHubFrontDoorLabel] != mcp.GenHubFrontDoorLabelValue {
		t.Fatalf("expected front-door label %s=%s, got %v", mcp.GenHubFrontDoorLabel, mcp.GenHubFrontDoorLabelValue, server.Labels)
	}
	if server.Spec.Manifest.Runtime != types.RuntimeComposite {
		t.Fatalf("expected runtime composite, got %s", server.Spec.Manifest.Runtime)
	}
	if server.Spec.UserID != "1" {
		t.Fatalf("expected owner user ID '1', got %s", server.Spec.UserID)
	}

	// 2. Idempotent check
	if err := reconcileFrontDoorComposite(t.Context(), client, "1"); err != nil {
		t.Fatalf("reconcileFrontDoorComposite() second run error = %v", err)
	}
}
