package auditlogs

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRedactHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("Authorization", "Bearer secret-token-123")
	headers.Set("Cookie", "session=abc")
	headers.Set("Content-Type", "application/json")
	headers.Set("X-API-Key", "sk-proj-secret")

	redacted := RedactHeaders(headers)

	assert.Equal(t, "[REDACTED]", redacted.Get("Authorization"))
	assert.Equal(t, "[REDACTED]", redacted.Get("Cookie"))
	assert.Equal(t, "[REDACTED]", redacted.Get("X-API-Key"))
	assert.Equal(t, "application/json", redacted.Get("Content-Type"))
}

func TestRedactHeaderMap(t *testing.T) {
	headers := map[string]string{
		"Authorization": "Bearer secret-token-123",
		"Content-Type":  "application/json",
		"X-API-Key":     "sk-12345",
	}

	redacted := RedactHeaderMap(headers)

	assert.Equal(t, "[REDACTED]", redacted["Authorization"])
	assert.Equal(t, "[REDACTED]", redacted["X-API-Key"])
	assert.Equal(t, "application/json", redacted["Content-Type"])
}
