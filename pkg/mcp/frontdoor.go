package mcp

import (
	"context"
	"errors"
	"fmt"

	"github.com/obot-platform/obot/apiclient/types"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	// GenHubFrontDoorLabel marks the one composite MCPServer published at /mcp.
	GenHubFrontDoorLabel = "genhub.io/front-door"
	// GenHubFrontDoorLabelValue is the only value accepted for the front-door marker.
	GenHubFrontDoorLabelValue = "true"
	// GenHubFrontDoorMCPServerName is stable so concurrent bootstrap attempts cannot create duplicates.
	GenHubFrontDoorMCPServerName = system.MCPServerPrefix + "gen-hub-front-door"
)

var (
	// ErrFrontDoorCompositeNotFound means bootstrap has not created a designated composite.
	ErrFrontDoorCompositeNotFound = errors.New("gen Hub front-door composite is not configured")
	// ErrFrontDoorCompositeConflict means more than one server carries the front-door marker.
	ErrFrontDoorCompositeConflict = errors.New("multiple Gen Hub front-door composites are configured")
	// ErrFrontDoorCompositeInvalid means the marked server cannot safely serve as the front door.
	ErrFrontDoorCompositeInvalid = errors.New("gen Hub front-door composite is invalid")
)

// ResolveFrontDoorComposite returns the only MCPServer marked as the Gen Hub front door.
// When ownerID is non-empty, the marked server must belong to that owner.
func ResolveFrontDoorComposite(ctx context.Context, client kclient.Client, namespace, ownerID string) (v1.MCPServer, error) {
	var servers v1.MCPServerList
	if err := client.List(ctx, &servers,
		kclient.InNamespace(namespace),
		kclient.MatchingLabels{GenHubFrontDoorLabel: GenHubFrontDoorLabelValue},
	); err != nil {
		return v1.MCPServer{}, fmt.Errorf("list Gen Hub front-door composites: %w", err)
	}

	switch len(servers.Items) {
	case 0:
		return v1.MCPServer{}, ErrFrontDoorCompositeNotFound
	case 1:
	default:
		return v1.MCPServer{}, fmt.Errorf("%w: found %d", ErrFrontDoorCompositeConflict, len(servers.Items))
	}

	server := servers.Items[0]
	if server.Spec.Template || server.Spec.CompositeName != "" ||
		server.Spec.Manifest.Runtime != types.RuntimeComposite ||
		server.Spec.Manifest.CompositeConfig == nil ||
		server.Spec.UserID == "" {
		return v1.MCPServer{}, fmt.Errorf("%w: marked server %q is not an owner composite", ErrFrontDoorCompositeInvalid, server.Name)
	}
	if ownerID != "" && server.Spec.UserID != ownerID {
		return v1.MCPServer{}, fmt.Errorf("%w: marked server %q belongs to another owner", ErrFrontDoorCompositeInvalid, server.Name)
	}

	return server, nil
}

// EnsureFrontDoorComposite idempotently creates the empty designated Composite Hub.
// The API create validator intentionally rejects general-purpose empty composites; bootstrap
// uses this narrow constructor so the Hub can exist before its first source MCP is added.
func EnsureFrontDoorComposite(ctx context.Context, client kclient.Client, namespace, ownerID string) (v1.MCPServer, error) {
	if ownerID == "" {
		return v1.MCPServer{}, fmt.Errorf("%w: owner ID is required", ErrFrontDoorCompositeInvalid)
	}

	server, err := ResolveFrontDoorComposite(ctx, client, namespace, ownerID)
	if err == nil {
		return server, nil
	}
	if !errors.Is(err, ErrFrontDoorCompositeNotFound) {
		return v1.MCPServer{}, err
	}

	server = v1.MCPServer{
		ObjectMeta: metav1.ObjectMeta{
			Name:      GenHubFrontDoorMCPServerName,
			Namespace: namespace,
			Labels: map[string]string{
				GenHubFrontDoorLabel: GenHubFrontDoorLabelValue,
			},
			Finalizers: []string{v1.MCPServerFinalizer},
		},
		Spec: v1.MCPServerSpec{
			Alias:  "Composite Hub",
			UserID: ownerID,
			Manifest: types.MCPServerManifest{
				Name:         "Composite Hub",
				Runtime:      types.RuntimeComposite,
				CompositeConfig: &types.CompositeRuntimeConfig{},
			},
		},
	}

	if err := client.Create(ctx, &server); err != nil && !apierrors.IsAlreadyExists(err) {
		return v1.MCPServer{}, fmt.Errorf("create Gen Hub front-door composite: %w", err)
	}

	server, err = ResolveFrontDoorComposite(ctx, client, namespace, ownerID)
	if err != nil {
		return v1.MCPServer{}, fmt.Errorf("resolve Gen Hub front-door composite after create: %w", err)
	}
	return server, nil
}

