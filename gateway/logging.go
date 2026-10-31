package main

import (
	"fmt"
	"sync"
	"time"
)

const logRingSize = 1000

type logEntry struct {
	Level   string `json:"level"`
	Time    string `json:"time"`
	Message string `json:"message"`
}

// sessionLogger 实现 core.Logger 契约：环形缓冲最近日志 + SSE 订阅扇出。
// 发送永不阻塞 SDK（慢消费者丢帧）。
type sessionLogger struct {
	mu   sync.Mutex
	ring []logEntry
	subs map[chan logEntry]struct{}
}

func newSessionLogger() *sessionLogger {
	return &sessionLogger{
		ring: make([]logEntry, 0, logRingSize),
		subs: make(map[chan logEntry]struct{}),
	}
}

func (l *sessionLogger) logf(level, format string, args ...any) {
	msg := format
	if len(args) > 0 {
		msg = fmt.Sprintf(format, args...)
	}
	entry := logEntry{Level: level, Time: time.Now().Format("15:04:05.000"), Message: msg}

	l.mu.Lock()
	if len(l.ring) >= logRingSize {
		l.ring = l.ring[1:]
	}
	l.ring = append(l.ring, entry)
	for ch := range l.subs {
		select {
		case ch <- entry:
		default:
		}
	}
	l.mu.Unlock()
}

func (l *sessionLogger) Debugf(format string, args ...any) { l.logf("debug", format, args...) }
func (l *sessionLogger) Infof(format string, args ...any)  { l.logf("info", format, args...) }
func (l *sessionLogger) Warnf(format string, args ...any)  { l.logf("warn", format, args...) }
func (l *sessionLogger) Errorf(format string, args ...any) { l.logf("error", format, args...) }

func (l *sessionLogger) recent() []logEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]logEntry, len(l.ring))
	copy(out, l.ring)
	return out
}

// subscribe 返回订阅通道与取消函数（不 close 通道，订阅端通过请求 ctx 退出）。
func (l *sessionLogger) subscribe() (<-chan logEntry, func()) {
	ch := make(chan logEntry, 256)
	l.mu.Lock()
	l.subs[ch] = struct{}{}
	l.mu.Unlock()
	return ch, func() {
		l.mu.Lock()
		delete(l.subs, ch)
		l.mu.Unlock()
	}
}
