package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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
}

// session = 一个上游账号的存活 SDK 客户端 + 它的日志管道。
type session struct {
	info   sessionInfo
	client yatori.Client
	logs   *sessionLogger
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

func (s *sessionStore) closeAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, se := range s.m {
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
