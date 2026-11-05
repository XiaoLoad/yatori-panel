package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func protectedHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func TestGatewayTokenRequired(t *testing.T) {
	protected := withGatewayAuth(protectedHandler(), "secret-token")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token should be rejected, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token should pass, got %d", rec.Code)
	}
}

func TestGatewayHealthAndEmptyToken(t *testing.T) {
	protected := withGatewayAuth(protectedHandler(), "secret-token")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health probe should not require token, got %d", rec.Code)
	}

	open := withGatewayAuth(protectedHandler(), "")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	rec = httptest.NewRecorder()
	open.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("empty token should preserve legacy local behavior, got %d", rec.Code)
	}
}

func TestGatewayCORSDefaultsToSameOrigin(t *testing.T) {
	t.Setenv("GATEWAY_CORS_ORIGIN", "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	withCORS(protectedHandler()).ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("CORS header should be absent by default, got %q", got)
	}

	origin := "http://localhost:5173"
	if err := os.Setenv("GATEWAY_CORS_ORIGIN", origin); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	withCORS(protectedHandler()).ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("expected fixed CORS origin %q, got %q", origin, got)
	}
}
