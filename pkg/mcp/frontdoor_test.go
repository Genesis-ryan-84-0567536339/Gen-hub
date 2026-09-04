package mcp

import (
	"errors"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const (
	frontDoorTestNamespace = "default"
)

func newFrontDoorTestClient(objects ...kclient.Object) kclient.Client {
	return fake.NewClientBuilder().WithScheme(storagescheme.Scheme).WithObjects(objects...).Build()
}

func frontDoorTestServer(name, owner string, marked bool) *v1.MCPServer {
	labels := map[string]string{}
	if marked {
		labels[GenHubFrontDoorLabel] = GenHubFrontDoorLabelValue
	}
	return &v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: frontDoorTestNamespace, Labels: labels},
		Spec: v1.MCPServerSpec{
			UserID: owner,
			Manifest: types.MCPServerManifest{
				Runtime:         types.RuntimeComposite,
				CompositeConfig: &types.CompositeRuntimeConfig{},
			},
		},
	}
}

func TestResolveFrontDoorCompositeRequiresExactlyOneMarker(t *testing.T) {
	ctx := t.Context()

	_, err := ResolveFrontDoorComposite(ctx, newFrontDoorTestClient(), frontDoorTestNamespace, "owner-1")
	if !errors.Is(err, ErrFrontDoorCompositeNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}

	client := newFrontDoorTestClient(
		frontDoorTestServer("first", "owner-1", true),
		frontDoorTestServer("second", "owner-1", true),
	)
	_, err = ResolveFrontDoorComposite(ctx, client, frontDoorTestNamespace, "owner-1")
	if !errors.Is(err, ErrFrontDoorCompositeConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

func TestResolveFrontDoorCompositeRejectsWrongOwnerAndInvalidMarker(t *testing.T) {
	ctx := t.Context()

	client := newFrontDoorTestClient(frontDoorTestServer("hub", "owner-2", true))
	_, err := ResolveFrontDoorComposite(ctx, client, frontDoorTestNamespace, "owner-1")
	if !errors.Is(err, ErrFrontDoorCompositeInvalid) {
		t.Fatalf("expected invalid owner error, got %v", err)
	}

	invalid := frontDoorTestServer("invalid", "owner-1", true)
	invalid.Spec.Manifest.Runtime = types.RuntimeRemote
	client = newFrontDoorTestClient(invalid)
	_, err = ResolveFrontDoorComposite(ctx, client, frontDoorTestNamespace, "owner-1")
	if !errors.Is(err, ErrFrontDoorCompositeInvalid) {
		t.Fatalf("expected invalid runtime error, got %v", err)
	}
}

func TestEnsureFrontDoorCompositeIsIdempotent(t *testing.T) {
	client := newFrontDoorTestClient()

	first, err := EnsureFrontDoorComposite(t.Context(), client, frontDoorTestNamespace, "owner-1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := EnsureFrontDoorComposite(t.Context(), client, frontDoorTestNamespace, "owner-1")
	if err != nil {
		t.Fatal(err)
	}

	if first.Name != GenHubFrontDoorMCPServerName || second.Name != first.Name {
		t.Fatalf("unexpected stable name: first=%q second=%q", first.Name, second.Name)
	}
	if first.Labels[GenHubFrontDoorLabel] != GenHubFrontDoorLabelValue {
		t.Fatalf("front-door marker missing: %#v", first.Labels)
	}
	if first.Spec.Manifest.CompositeConfig == nil || len(first.Spec.Manifest.CompositeConfig.ComponentServers) != 0 {
		t.Fatalf("expected an empty composite config, got %#v", first.Spec.Manifest.CompositeConfig)
	}

	var list v1.MCPServerList
	if err := client.List(t.Context(), &list, kclient.InNamespace(frontDoorTestNamespace)); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 1 {
		t.Fatalf("expected one composite after repeated ensure, got %d", len(list.Items))
	}
}
