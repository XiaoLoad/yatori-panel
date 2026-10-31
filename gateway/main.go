// Command gateway exposes the yatori-go-core SDK as a local HTTP service so
// that non-Go applications (the yatori-panel Node backend) can reuse every
// platform adapter through plain JSON and SSE.
//
// 网关不承载任何业务逻辑：只持有"每个上游账号一个 SDK 会话"的注册表，
// 把 REST 调用一一映射到 yatori.Client 契约。调度、持久化、UI 都在面板后端。
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:9801", "HTTP listen address")
	flag.Parse()

	store := newSessionStore()
	mux := http.NewServeMux()
	registerRoutes(mux, store)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           withCORS(withLogging(mux)),
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
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("[gateway] server error: %v", err)
	}
	store.closeAll()
	log.Printf("[gateway] stopped")
}

// withCORS 允许面板前端（任意本地端口）直连调试。
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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
