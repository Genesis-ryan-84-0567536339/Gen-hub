package oauth

import (
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/mcp"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	"github.com/obot-platform/obot/pkg/system"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestResolveMCPIDForFrontDoorResource(t *testing.T) {
	server := &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:      mcp.GenHubFrontDoorMCPServerName,
			Namespace: system.DefaultNamespace,
			Labels: map[string]string{
				mcp.GenHubFrontDoorLabel: mcp.GenHubFrontDoorLabelValue,
			},
		},
		Spec: v1.MCPServerSpec{
			UserID: "owner-1",
			Manifest: types.MCPServerManifest{
				Runtime:         types.RuntimeComposite,
				CompositeConfig: &types.CompositeRuntimeConfig{},
			},
		},
	}
	client := fake.NewClientBuilder().WithScheme(storagescheme.Scheme).WithObjects(server).Build()

	got, frontDoor, err := resolveMCPIDForResource(t.Context(), client, "https://hub.example", "https://hub.example/mcp", "")
	if err != nil {
		t.Fatal(err)
	}
	if !frontDoor || got != server.Name {
		t.Fatalf("resolved ID/frontDoor = %q/%v", got, frontDoor)
	}
}

func TestResolveMCPIDForResourceRejectsMissingFrontDoor(t *testing.T) {
	client := fake.NewClientBuilder().WithScheme(storagescheme.Scheme).Build()
	_, frontDoor, err := resolveMCPIDForResource(t.Context(), client, "https://hub.example", "https://hub.example/mcp", "")
	if !frontDoor || err == nil {
		t.Fatalf("frontDoor/error = %v/%v", frontDoor, err)
	}
}

func TestFrontDoorResourceMustMatchPublicOriginExactly(t *testing.T) {
	for _, resource := range []string{
		"https://attacker.example/mcp",
		"https://hub.example/mcp?target=other",
		"https://hub.example/mcp/other",
	} {
		if isFrontDoorResource(resource, "https://hub.example") {
			t.Fatalf("accepted invalid front-door resource %q", resource)
		}
	}
}
