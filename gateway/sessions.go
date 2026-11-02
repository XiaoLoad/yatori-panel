package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"sync"
	"time"

	yatori "github.com/yatori-dev/yatori-go-core"
)

type sessionInfo struct {
	ID           string   `json:"sessionId"`
	Platform     string   `json:"platform"`
	PlatformName string   `json:"platformName"`
	Account      string   `json:"account"`
	Capabilities []string `json:"capabilities"`
	CreatedAt    string   `json:"createdAt"`
	State        string   `json:"state"` // logging_in / online / error
	LastError    string   `json:"lastError,omitempty"`
	// ConfigFingerprint 创建会话时 AI/题库配置的指纹（sha256 前 16 位）。
	// 面板复用会话前比对当前配置指纹，不一致则重建会话——SDK 的
	// Options 在创建后不可更新，旧会话不会自动获得新配置。
	ConfigFingerprint string `json:"configFingerprint,omitempty"`
}

// session = 一个上游账号的存活 SDK 客户端 + 它的日志管道 + 心跳保活。
type session struct {
	info   sessionInfo
	client yatori.Client
	logs   *sessionLogger

	// 心跳保活所需的上游会话凭据（对齐 core 的 KeepAliveApi：token 走表单，
	// cookie 辅助）。token 为空的平台（无此机制）不启动心跳。
	baseURL      string
	token        string
	cookieHeader string

	stateMu     sync.RWMutex
	state       string
	lastError   string
	loginCancel func()

	stopHB    chan struct{}
	stopOnce  sync.Once
	startOnce sync.Once

	// coursesWarmed 标记本会话是否已加载过课程缓存（SDK 适配器在
	// Courses() 时缓存课程原始数据，Tree/Works/Exams 依赖该缓存；
	// 会话重建后若直接调 Tree 会报 "course raw data is missing"）。
	coursesWarmed bool
	coursesMu     sync.Mutex
}

// ensureCoursesWarmed 首次调用时拉一次课程列表以填充 SDK 内部缓存。
// 并发安全：多请求同时到达只预热一次。
func (s *session) ensureCoursesWarmed(ctx context.Context) error {
	s.coursesMu.Lock()
	defer s.coursesMu.Unlock()
	if s.coursesWarmed {
		return nil
	}
	if _, err := s.client.Courses(ctx); err != nil {
		return err
	}
	s.coursesWarmed = true
	return nil
}

// setState 更新会话生命周期状态（logging_in / online / error）。
func (s *session) setState(state, errMsg string) {
	s.stateMu.Lock()
	s.state = state
	s.lastError = errMsg
	s.info.State = state
	s.info.LastError = errMsg
	s.stateMu.Unlock()
}

func (s *session) currentState() string {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.state
}

const heartbeatInterval = 5 * time.Minute

// startHeartbeat 每 5 分钟向上游发一次在线心跳，对齐 console 的
// keepAliveLogin 协程。失败静默：真正的会话失效由面板层超时重登兜底。
func (s *session) startHeartbeat() {
	if s.baseURL == "" || s.token == "" {
		return
	}
	s.startOnce.Do(func() {
		s.stopHB = make(chan struct{})
		go func() {
			ticker := time.NewTicker(heartbeatInterval)
			defer ticker.Stop()
			tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
			client := &http.Client{Timeout: 15 * time.Second, Transport: tr}
			for {
				select {
				case <-s.stopHB:
					return
				case <-ticker.C:
					if ok := s.sendKeepAlive(client); !ok {
						s.logs.logf("warn", "keepalive heartbeat failed")
					} else {
						s.logs.logf("debug", "keepalive heartbeat ok")
					}
				}
			}
		}()
	})
}

// sendKeepAlive 复刻 core KeepAliveApi 的请求形态。
func (s *session) sendKeepAlive(client *http.Client) bool {
	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)
	_ = writer.WriteField("platform", "Android")
	_ = writer.WriteField("version", "1.4.8")
	_ = writer.WriteField("token", s.token)
	if writer.Close() != nil {
		return false
	}
	req, err := http.NewRequest("POST", strings.TrimRight(s.baseURL, "/")+"/api/online.json", payload)
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "Mozilla/5.0")
	if s.cookieHeader != "" {
		req.Header.Set("Cookie", s.cookieHeader)
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.ReadAll(io.LimitReader(resp.Body, 4096))
	return resp.StatusCode == http.StatusOK
}

func (s *session) stop() {
	s.stopOnce.Do(func() {
		if s.stopHB != nil {
			close(s.stopHB)
		}
	})
	s.stateMu.RLock()
	cancel := s.loginCancel
	s.stateMu.RUnlock()
	if cancel != nil {
		cancel()
	}
}

type sessionStore struct {
	mu sync.RWMutex
	m  map[string]*session
}

func newSessionStore() *sessionStore {
	return &sessionStore{m: make(map[string]*session)}
}

func (s *sessionStore) put(se *session) {
	s.mu.Lock()
	s.m[se.info.ID] = se
	s.mu.Unlock()
}

func (s *sessionStore) get(id string) (*session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	se, ok := s.m[id]
	return se, ok
}

func (s *sessionStore) remove(id string) (*session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	se, ok := s.m[id]
	if ok {
		delete(s.m, id)
	}
	return se, ok
}

func (s *sessionStore) list() []sessionInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]sessionInfo, 0, len(s.m))
	for _, se := range s.m {
		out = append(out, se.info)
	}
	return out
}

// removeFailedFor 清理同平台同账号处于 error 状态的历史会话，
// 防止反复登录失败导致网关侧会话堆积。
func (s *sessionStore) removeFailedFor(platform, account string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, se := range s.m {
		if se.info.Platform == platform && se.info.Account == account && se.currentState() == "error" {
			se.stop()
			_ = se.client.Close()
			delete(s.m, id)
		}
	}
}

func (s *sessionStore) closeAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, se := range s.m {
		se.stop()
		_ = se.client.Close()
		delete(s.m, id)
	}
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// capsToStrings 把能力位转成稳定的能力名列表（与 core/capability.go 命名一致）。
func capsToStrings(caps yatori.Capability) []string {
	out := []string{}
	flags := []struct {
		flag yatori.Capability
		name string
	}{
		{yatori.CapLogin, "login"},
		{yatori.CapCookieLogin, "cookie-login"},
		{yatori.CapCourses, "courses"},
		{yatori.CapTree, "tree"},
		{yatori.CapStudy, "study"},
		{yatori.CapWorks, "works"},
		{yatori.CapExams, "exams"},
		{yatori.CapSignIn, "sign-in"},
		{yatori.CapQRCodeLogin, "qr-code-login"},
	}
	for _, item := range flags {
		if caps.Has(item.flag) {
			out = append(out, item.name)
		}
	}
	return out
}
