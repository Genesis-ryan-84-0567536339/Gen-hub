package auditlogs

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
)

const (
	OutcomeSuccess = "Success"
	OutcomeError   = "Error"
	OutcomeDenied  = "Denied"
)

var (
	sensitiveHeaders = []string{
		"authorization",
		"cookie",
		"set-cookie",
		"x-api-key",
		"proxy-authorization",
		"x-auth-token",
		"x-session-token",
	}
)

// RedactHeaders scrubs sensitive authentication tokens and cookies from HTTP header maps.
func RedactHeaders(headers http.Header) http.Header {
	if headers == nil {
		return nil
	}
	redacted := headers.Clone()
	for _, key := range sensitiveHeaders {
		if redacted.Get(key) != "" {
			redacted.Set(key, "[REDACTED]")
		}
	}
	return redacted
}

// RedactHeaderMap scrubs sensitive keys from raw string map headers.
func RedactHeaderMap(headers map[string]string) map[string]string {
	if headers == nil {
		return nil
	}
	redacted := make(map[string]string, len(headers))
	for k, v := range headers {
		lowerK := strings.ToLower(k)
		if slices.Contains(sensitiveHeaders, lowerK) {
			redacted[k] = "[REDACTED]"
		} else {
			redacted[k] = v
		}
	}
	return redacted
}

// RedactJSONHeaderRaw returns redacted JSON bytes for header maps.
func RedactJSONHeaderRaw(headers http.Header) json.RawMessage {
	redacted := RedactHeaders(headers)
	data, err := json.Marshal(redacted)
	if err != nil {
		return nil
	}
	return json.RawMessage(data)
}
