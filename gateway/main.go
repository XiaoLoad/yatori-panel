// Command gateway exposes the yatori-go-core SDK as a local HTTP service so
// that non-Go applications (the yatori-panel Node backend) can reuse every
// platform adapter through plain JSON and SSE.
//
// 网关不承载任何业务逻辑：只持有"每个上游账号一个 SDK 会话"的注册表，
// 把 REST 调用一一映射到 yatori.Client 契约。调度、持久化、UI 都在面板后端。
package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:9801", "HTTP listen address")
	healthCheck := flag.Bool("health-check", false, "perform a local health probe and exit")
	flag.Parse()

	if *healthCheck {
		if err := probeLocalHealth(); err != nil {
			log.Fatalf("[gateway] health check failed: %v", err)
		}
		return
	}

	token := strings.TrimSpace(os.Getenv("GATEWAY_TOKEN"))
	store := newSessionStore()
	mux := http.NewServeMux()
	registerRoutes(mux, store)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           withGatewayAuth(withCORS(withLogging(mux)), token),
		ReadHeaderTimeout: 10 * time.Second,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-done
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("[gateway] listening on http://%s", *addr)
	if token != "" {
		log.Printf("[gateway] shared token authentication enabled")
	} else {
		log.Printf("[gateway] shared token not set; local loopback deployments should set GATEWAY_TOKEN")
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[gateway] server error: %v", err)
	}
	store.closeAll()
	log.Printf("[gateway] stopped")
}

// withGatewayAuth 校验面板侧共享密钥。token 为空时保持旧行为，方便本地回环部署平滑升级。
// /health 供容器探针免鉴权调用；其余接口一律校验，避免同网络内任意进程读取登录态。
func withGatewayAuth(next http.Handler, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" || r.URL.Path == "/api/v1/health" || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, prefix) || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(header[len(prefix):])), []byte(token)) != 1 {
			fail(w, http.StatusUnauthorized, "gateway token required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withCORS 默认仅允许同源调试；网关与面板在 Docker 网络中由服务端互调，不开放浏览器直连。
// 需要浏览器跨域调试时显式设置 GATEWAY_CORS_ORIGIN，绝不反射任意 Origin。
func withCORS(next http.Handler) http.Handler {
	origin := strings.TrimSpace(os.Getenv("GATEWAY_CORS_ORIGIN"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// probeLocalHealth 供容器 healthcheck 调用：不依赖 curl/wget，探测本机网关健康接口。
func probeLocalHealth() error {
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1:9801/api/v1/health")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", res.StatusCode)
	}
	return nil
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/api/v1/health" { // 健康检查刷屏
			log.Printf("[http] %s %s (%s)", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}
