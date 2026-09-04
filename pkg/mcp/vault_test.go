package mcp

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMaskSecret(t *testing.T) {
	assert.Equal(t, "", MaskSecret(""))
	assert.Equal(t, "****", MaskSecret("123"))
	assert.Equal(t, "****", MaskSecret("abcd"))
	assert.Equal(t, "sk****99", MaskSecret("sk-proj-secret-key-99"))
}

func TestIsConnectorSupported(t *testing.T) {
	supported := []string{
		"github", "google-drive", "web-search", "postgresql",
		"filesystem", "gmail", "google-calendar", "slack",
	}

	for _, c := range supported {
		assert.True(t, IsConnectorSupported(c), "Expected %s to be supported", c)
	}

	assert.False(t, IsConnectorSupported("unsupported-connector"))
}
