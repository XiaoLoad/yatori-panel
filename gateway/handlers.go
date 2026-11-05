package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	yatori "github.com/yatori-dev/yatori-go-core"
	"github.com/yatori-dev/yatori-go-core/models/ctype"
	"github.com/yatori-dev/yatori-go-core/que-core/aiq"
	"github.com/yatori-dev/yatori-go-core/que-core/external"
)

type gateway struct {
	store     *sessionStore
	platforms []platformMeta
}

func registerRoutes(mux *http.ServeMux, store *sessionStore) {
	g := &gateway{store: store, platforms: buildPlatformMeta()}

	// SDK 调用超时包装：上游接口卡死（如平台风控页重试循环）时，
	// 会话互斥锁会让后续请求无限排队，最终拖垮整个网关。
	// 每类路由限时返回 504，保证网关整体可用性。
	const sdkTimeout = 60 * time.Second    // 列表/树等普通读取
	const answerTimeout = 30 * time.Minute // 作业/考试/学时：本身就是长操作

	long := withTimeoutMiddleware(sdkTimeout)
	xlong := withTimeoutMiddleware(answerTimeout)

	mux.HandleFunc("GET /api/v1/health", g.handleHealth)
	mux.HandleFunc("GET /api/v1/platforms", g.handlePlatforms) // 纯内存
	mux.HandleFunc("POST /api/v1/preflight", long(g.handlePreflight))
	mux.HandleFunc("POST /api/v1/sessions", xlong(g.handleCreateSession)) // 含登录等待
	mux.HandleFunc("GET /api/v1/sessions", long(g.handleListSessions))
	mux.HandleFunc("GET /api/v1/sessions/{id}", long(g.handleSessionInfo))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", long(g.handleCloseSession))

	mux.HandleFunc("GET /api/v1/sessions/{id}/courses", long(g.handleCourses))
	mux.HandleFunc("GET /api/v1/sessions/{id}/profile", long(g.handleProfile))
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/tree", long(g.handleTree))
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/works", long(g.handleWorks))
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/exams", long(g.handleExams))

	mux.HandleFunc("POST /api/v1/sessions/{id}/study", xlong(g.handleStudy))
	mux.HandleFunc("POST /api/v1/sessions/{id}/works/do", xlong(g.handleDoWork))
	mux.HandleFunc("POST /api/v1/sessions/{id}/exams/do", xlong(g.handleDoExam))
	mux.HandleFunc("POST /api/v1/sessions/{id}/exams/detail", g.handleExamDetail)          // SSE 逐题流
	mux.HandleFunc("POST /api/v1/sessions/{id}/exams/results", xlong(g.handleExamResults)) // 考试结果只读查询
	mux.HandleFunc("POST /api/v1/sessions/{id}/works/results", xlong(g.handleWorkResults)) // 作业结果只读查询

	mux.HandleFunc("GET /api/v1/sessions/{id}/logs", g.handleLogStream) // SSE 长连接，不适用
	mux.HandleFunc("GET /api/v1/sessions/{id}/logs/recent", long(g.handleRecentLogs))
}

// withTimeoutMiddleware 给 handler 套 context 截止时间：超时返回 504。
// 注意：这只让 HTTP 响应及时返回，被阻塞的 SDK 调用（等待会话锁）
// 仍在后台排队——彻底解死锁需上游支持 ctx 取消，此处是服务可用性兜底。
func withTimeoutMiddleware(d time.Duration) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			done := make(chan struct{})
			tw := newTimeoutWriter(w)
			go func() {
				defer close(done)
				next(tw, r.WithContext(ctx))
			}()
			select {
			case <-done:
				return
			case <-ctx.Done():
				tw.markTimedOut()
				if !tw.wroteHeader {
					fail(w, http.StatusGatewayTimeout, "上游平台响应超时，请稍后重试或重启网关")
				}
			}
		}
	}
}

// timeoutWriter 屏蔽超时后后台 goroutine 的写操作（写已关闭的响应会 panic）。
type timeoutWriter struct {
	http.ResponseWriter
	wroteHeader bool
	mu          sync.Mutex
	timedOut    bool
}

func newTimeoutWriter(w http.ResponseWriter) *timeoutWriter {
	return &timeoutWriter{ResponseWriter: w}
}

func (t *timeoutWriter) WriteHeader(code int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return
	}
	t.wroteHeader = true
	t.ResponseWriter.WriteHeader(code)
}

func (t *timeoutWriter) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timedOut {
		return 0, http.ErrHandlerTimeout
	}
	t.wroteHeader = true
	return t.ResponseWriter.Write(b)
}

// markTimedOut 在超时分支调用，之后后台 goroutine 的写被丢弃。
func (t *timeoutWriter) markTimedOut() {
	t.mu.Lock()
	t.timedOut = true
	t.mu.Unlock()
}

// ---------- 基础 ----------

func (g *gateway) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]string{"status": "up", "service": "yatori-gateway"}})
}

func (g *gateway) handlePlatforms(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": g.platforms})
}

// handlePreflight 对 AI / 外置题库配置做可用性预检（对齐 console 的
// AICheck / CheckApiQueRequest 前置检查）。纯配置探活，不触碰任何
// 平台会话与作业/考试。
func (g *gateway) handlePreflight(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source       string       `json:"source"` // ai | bank
		AI           *aiConfigDTO `json:"ai"`
		QuestionBank *bankDTO     `json:"questionBank"`
	}
	if !readJSON(w, r, &req) {
		return
	}

	var checkErr error
	switch req.Source {
	case "ai":
		if req.AI == nil {
			fail(w, http.StatusBadRequest, "缺少 AI 配置")
			return
		}
		checkErr = withTimeout(45*time.Second, func() error {
			return aiq.AICheck(req.AI.URL, req.AI.Model, req.AI.APIKey, ctype.AiType(req.AI.Type))
		})
	case "bank":
		if req.QuestionBank == nil || req.QuestionBank.URL == "" {
			fail(w, http.StatusBadRequest, "缺少题库地址")
			return
		}
		checkErr = withTimeout(45*time.Second, func() error {
			return external.CheckApiQueRequest(req.QuestionBank.URL, 3, nil)
		})
	default:
		fail(w, http.StatusBadRequest, "未知预检来源: "+req.Source)
		return
	}

	if checkErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":   true,
			"data": map[string]any{"available": false, "error": checkErr.Error()},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": map[string]any{"available": true},
	})
}

// withTimeout 给无 context 参数的 core 探活函数套一层超时保护。
func withTimeout(d time.Duration, fn func() error) error {
	done := make(chan error, 1)
	go func() { done <- fn() }()
	select {
	case err := <-done:
		return err
	case <-time.After(d):
		return errors.New("预检超时")
	}
}

// ---------- 会话 ----------

type aiConfigDTO struct {
	Type   string `json:"type"` // TONGYI / DEEPSEEK / OPENAI ...
	URL    string `json:"url"`
	Model  string `json:"model"`
	APIKey string `json:"apiKey"`
}

type bankDTO struct {
	URL            string `json:"url"`
	Key            string `json:"key"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

type createSessionRequest struct {
	Platform            string       `json:"platform"`
	Username            string       `json:"username"`
	Password            string       `json:"password"`
	URL                 string       `json:"url"`
	School              string       `json:"school"`
	Cookie              string       `json:"cookie"` // 支持 Cookie 登录的平台可用其代替账密
	ProxyURL            string       `json:"proxyURL"`
	LoginTimeoutSeconds int          `json:"loginTimeoutSeconds"`
	AI                  *aiConfigDTO `json:"ai"`
	QuestionBank        *bankDTO     `json:"questionBank"`
	// ConfigFingerprint 面板侧计算并透传的配置指纹，网关只存/回显不做解释。
	// 面板复用会话时比对当前指纹与此值，不一致即重建会话。
	ConfigFingerprint string `json:"configFingerprint,omitempty"`
}

func (g *gateway) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var req createSessionRequest
	if !readJSON(w, r, &req) {
		return
	}
	platform, err := yatori.ParsePlatform(req.Platform)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	// 兼容用户粘贴带路径的登录页地址（如 https://host/user）
	req.URL = normalizeAccountURL(platform.String(), req.URL)

	logger := newSessionLogger()
	opts := yatori.Options{
		ProxyURL: req.ProxyURL,
		Timeout:  60 * time.Second,
		Logger:   logger,
	}
	if req.AI != nil {
		opts.AI = &yatori.AIConfig{
			Type:   yatori.AIType(req.AI.Type),
			URL:    req.AI.URL,
			Model:  req.AI.Model,
			APIKey: req.AI.APIKey,
		}
	}
	if req.QuestionBank != nil {
		bankTimeout := 30 * time.Second
		if req.QuestionBank.TimeoutSeconds > 0 {
			bankTimeout = time.Duration(req.QuestionBank.TimeoutSeconds) * time.Second
		}
		opts.QuestionBank = &yatori.QuestionBankConfig{
			URL:     req.QuestionBank.URL,
			Key:     req.QuestionBank.Key,
			Timeout: bankTimeout,
		}
	}

	cfg := yatori.Config{
		Platform: platform,
		Account: yatori.Account{
			Username: req.Username,
			Password: req.Password,
			URL:      req.URL,
			School:   req.School,
			Cookie:   req.Cookie,
		},
		Options: opts,
	}

	client, err := yatori.New(cfg)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}

	// 登录异步化：会话先以 logging_in 状态入库并立即返回，登录过程
	// 通过会话日志流实时可见，结果经状态机（online/error）回传。
	loginTimeout := time.Duration(req.LoginTimeoutSeconds) * time.Second
	if loginTimeout <= 0 {
		loginTimeout = 90 * time.Second
	}

	se := &session{
		info: sessionInfo{
			ID:                newID(),
			Platform:          platform.String(),
			PlatformName:      platform.Description(),
			Account:           req.Username,
			Capabilities:      capsToStrings(client.Capabilities()),
			CreatedAt:         time.Now().Format(time.RFC3339),
			State:             "logging_in",
			ConfigFingerprint: req.ConfigFingerprint,
		},
		client: client,
		logs:   logger,
	}
	sess := client.Session()
	se.baseURL = sess.Extra["url"]
	se.token = sess.Token
	se.cookieHeader = sess.Cookie
	if se.cookieHeader == "" && sess.Token != "" {
		se.cookieHeader = "token=" + sess.Token
	}
	// 英华逐题模式（方案 B）需要账密自建完整 Cookie 会话
	se.yhUsername = req.Username
	se.yhPassword = req.Password
	// 清理同账号失败的历史会话，避免反复登录失败导致堆积
	g.store.removeFailedFor(platform.String(), req.Username)
	g.store.put(se)

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), loginTimeout)
		defer cancel()
		se.stateMu.Lock()
		se.loginCancel = cancel
		se.stateMu.Unlock()

		var loginErr error
		if req.Cookie != "" {
			loginErr = client.LoginWithCookie(ctx, req.Cookie)
		} else {
			loginErr = client.Login(ctx)
		}
		if loginErr != nil {
			se.setState("error", loginErr.Error())
			se.logs.logf("error", "登录失败: %s", loginErr.Error())
			return
		}
		sess := client.Session()
		se.baseURL = sess.Extra["url"]
		se.token = sess.Token
		se.cookieHeader = sess.Cookie
		if se.cookieHeader == "" && sess.Token != "" {
			se.cookieHeader = "token=" + sess.Token
		}
		se.setState("online", "")
		se.startHeartbeat()
		se.logs.logf("info", "登录成功")
	}()

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": se.info})
}

func (g *gateway) handleListSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": g.store.list()})
}

func (g *gateway) sessionFrom(r *http.Request) (*session, bool) {
	se, ok := g.store.get(r.PathValue("id"))
	return se, ok
}

func (g *gateway) handleSessionInfo(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]any{
		"info": se.info,
		// 会话快照含上游 cookie/token，默认不再外发；仅显式开启调试开关时返回。
		"session": sessionSnapshot(se, os.Getenv("GATEWAY_DEBUG_SESSION") == "true"),
	}})
}

// sessionSnapshot 默认只返回可读状态，避免上游登录凭据经调试接口泄露。
func sessionSnapshot(se *session, includeRaw bool) any {
	if !includeRaw {
		return map[string]any{"redacted": true}
	}
	return se.client.Session()
}

func (g *gateway) handleCloseSession(w http.ResponseWriter, r *http.Request) {
	se, ok := g.store.remove(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	se.stop()
	_ = se.client.Close()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- 课程 / 章节 / 作业 / 考试 ----------

func (g *gateway) handleCourses(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	courses, err := func() ([]yatori.Course, error) {
		ctx, cancel := sdkCtx(r, sdkTimeout)
		defer cancel()
		return se.client.Courses(ctx)
	}()
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	list := make([]courseDTO, 0, len(courses))
	for _, c := range courses {
		list = append(list, dtoCourse(c))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": list})
}

func (g *gateway) handleTree(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	tree, err := func() ([]yatori.Node, error) {
		ctx, cancel := sdkCtx(r, sdkTimeout)
		defer cancel()
		if err := se.ensureCoursesWarmed(ctx); err != nil {
			return nil, err
		}
		return se.client.Tree(ctx, yatori.Course{ID: r.PathValue("courseId")})
	}()
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	nodes := make([]nodeDTO, 0, len(tree))
	for _, n := range tree {
		nodes = append(nodes, dtoNode(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": nodes})
}

func (g *gateway) handleWorks(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	works, err := func() ([]yatori.Work, error) {
		ctx, cancel := sdkCtx(r, sdkTimeout)
		defer cancel()
		if err := se.ensureCoursesWarmed(ctx); err != nil {
			return nil, err
		}
		return se.client.Works(ctx, yatori.Course{ID: r.PathValue("courseId")})
	}()
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	list := make([]workDTO, 0, len(works))
	for _, item := range works {
		list = append(list, dtoWork(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": list})
}

func (g *gateway) handleExams(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	exams, err := func() ([]yatori.Exam, error) {
		ctx, cancel := sdkCtx(r, sdkTimeout)
		defer cancel()
		if err := se.ensureCoursesWarmed(ctx); err != nil {
			return nil, err
		}
		return se.client.Exams(ctx, yatori.Course{ID: r.PathValue("courseId")})
	}()
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	list := make([]examDTO, 0, len(exams))
	for _, item := range exams {
		list = append(list, dtoExam(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": list})
}

// handleProfile 返回上游平台的登录用户信息（当前支持英华：从登录后
// 首页的 HTML 提取姓名）。注意 core.Session 的 Token 即会话 Cookie 值。
func (g *gateway) handleProfile(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	sess := se.client.Session()
	base := sess.Extra["url"]
	if base == "" {
		fail(w, http.StatusBadRequest, "该平台未提供站点地址，无法获取用户信息")
		return
	}
	cookie := sess.Cookie
	if cookie == "" && sess.Token != "" {
		cookie = "token=" + sess.Token
	}
	if cookie == "" {
		fail(w, http.StatusBadRequest, "会话缺少凭据，请重新登录")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, base+"/user", nil)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Cookie", cookie)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	// 与 core 一致：部分学校站点证书链不完整
	tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	resp, err := (&http.Client{Timeout: 15 * time.Second, Transport: tr}).Do(req)
	if err != nil {
		fail(w, mapStatus(err), "站点访问失败: "+err.Error())
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}

	var name string
	if m := nameRe.FindSubmatch(body); m != nil {
		name = strings.TrimSpace(string(m[1]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]string{"name": name}})
}

var nameRe = regexp.MustCompile(`(?i)<div class="name">\s*([^<]+?)\s*<`)

// ---------- 学习 / 答题 ----------

// sdkTimeout 是单次 SDK 调用的兜底超时：HTTP 请求 context 只有在客户端断开时
// 才取消，而面板侧的 fetch 若无超时则永不断开——上游一旦挂起，handler 会被
// 无限拖住。对齐 console 各 API 的 30s client timeout。
const sdkTimeout = 30 * time.Second

// answerTimeout 是作业/考试作答的超时：AI/题库逐题作答耗时较长，单独放宽。
const answerTimeout = 10 * time.Minute

// sdkCtx 为 SDK 调用包一层超时，防止上游挂起把 handler 无限拖住。
func sdkCtx(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}

type studyRequest struct {
	CourseID        string         `json:"courseId"`
	NodeID          string         `json:"nodeId"`
	Action          string         `json:"action"`          // start / progress / pause / finish
	Mode            string         `json:"mode"`            // normal / fast / web
	PositionSeconds float64        `json:"positionSeconds"` // 已观看秒数（下一次提交的目标位置）
	DurationSeconds float64        `json:"durationSeconds"`
	IsDrag          bool           `json:"isDrag"`
	Extra           map[string]any `json:"extra"`
}

func (g *gateway) handleStudy(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	var req studyRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Action == "" {
		req.Action = string(yatori.StudyActionProgress)
	}
	if req.Mode == "" {
		req.Mode = string(yatori.StudyModeNormal)
	}

	// 英华：SDK 适配器把 studyId 写死为 "0"，平台无法累计学时，改走网关直连，
	// 由网关按节点续用平台分配的 studyId（对齐 console）。
	if se.info.Platform == string(yatori.YingHua) && se.baseURL != "" && se.token != "" {
		if se.currentState() != "online" {
			fail(w, http.StatusUnauthorized, "session not online")
			return
		}
		result, err := studyYingHua(r.Context(), se, req)
		if err != nil {
			fail(w, mapStatus(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": dtoStudyResult(result)})
		return
	}

	// 只传 ID：适配器会回查内部缓存（前提：先调过 Tree / Works）。
	ctx, cancel := sdkCtx(r, sdkTimeout)
	defer cancel()
	result, err := se.client.Study(ctx, yatori.StudyRequest{
		Course:   yatori.Course{ID: req.CourseID},
		Node:     yatori.Node{ID: req.NodeID},
		Action:   yatori.StudyAction(req.Action),
		Mode:     yatori.StudyMode(req.Mode),
		Position: secondsToDuration(req.PositionSeconds),
		Duration: secondsToDuration(req.DurationSeconds),
		IsDrag:   req.IsDrag,
		Extra:    req.Extra,
	})
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": dtoStudyResult(result)})
}

type doWorkRequest struct {
	CourseID string `json:"courseId"`
	WorkID   string `json:"workId"`
	Source   string `json:"source"` // ai / bank
	Submit   bool   `json:"submit"`
}

func (g *gateway) handleDoWork(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	var req doWorkRequest
	if !readJSON(w, r, &req) {
		return
	}
	ctx, cancel := sdkCtx(r, answerTimeout)
	defer cancel()
	result, err := se.client.DoWork(ctx, yatori.WorkRequest{
		Course: yatori.Course{ID: req.CourseID},
		Work:   yatori.Work{ID: req.WorkID},
		Source: yatori.AnswerSource(req.Source),
		Submit: req.Submit,
	})
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": dtoAnswerResult(result)})
}

type doExamRequest struct {
	CourseID string `json:"courseId"`
	ExamID   string `json:"examId"`
	Source   string `json:"source"`
	Submit   bool   `json:"submit"`
}

func (g *gateway) handleDoExam(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	var req doExamRequest
	if !readJSON(w, r, &req) {
		return
	}
	ctx, cancel := sdkCtx(r, answerTimeout)
	defer cancel()
	result, err := se.client.DoExam(ctx, yatori.ExamRequest{
		Course: yatori.Course{ID: req.CourseID},
		Exam:   yatori.Exam{ID: req.ExamID},
		Source: yatori.AnswerSource(req.Source),
		Submit: req.Submit,
	})
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": dtoAnswerResult(result)})
}

// handleExamDetail 逐题模式考试：SSE 流式返回逐题进度与最终结果。
// 请求体同 doExamRequest，另需题库地址（source 固定 bank）。
// 仅支持英华（协议复刻自其底层 API）；其他平台回退 400。
func (g *gateway) handleExamDetail(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	if se.info.Platform != "YINGHUA" {
		fail(w, http.StatusBadRequest, "逐题模式暂仅支持英华学堂，其他平台请用普通答题")
		return
	}
	var req struct {
		CourseID   string `json:"courseId"`
		ExamID     string `json:"examId"`
		NodeID     string `json:"nodeId"`
		BankURL    string `json:"bankUrl"`
		SubmitMode string `json:"submitMode"` // off / smart / direct
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.ExamID == "" {
		fail(w, http.StatusBadRequest, "缺少考试 ID")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	writeEvent := func(event string, payload any) bool {
		data, err := json.Marshal(payload)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	result, err := RunExamDetailWithCreds(r.Context(), se.client.Session(), se.yhUsername, se.yhPassword,
		req.CourseID, req.ExamID, req.NodeID, req.BankURL, req.SubmitMode,
		func(p examProgress) {
			_ = writeEvent("progress", p)
		})
	if err != nil {
		_ = writeEvent("error", map[string]string{"error": err.Error()})
		return
	}
	_ = writeEvent("result", result)
}

// handleExamResults 只读查询考试参与状态与最终得分（仅英华，不进入考试流程）。
func (g *gateway) handleExamResults(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	if se.info.Platform != "YINGHUA" {
		fail(w, http.StatusBadRequest, "考试状态与成绩查询暂仅支持英华学堂")
		return
	}
	var req struct {
		CourseID string      `json:"courseId"`
		Exams    []yhExamKey `json:"exams"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Exams) == 0 {
		fail(w, http.StatusBadRequest, "缺少考试列表")
		return
	}
	if len(req.Exams) > 30 {
		fail(w, http.StatusBadRequest, "单次最多查询 30 场考试")
		return
	}
	results, err := RunExamResultsWithCreds(r.Context(), se.client.Session(), se.yhUsername, se.yhPassword, req.Exams)
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": results})
}

// handleWorkResults 只读查询作业参与状态与最终得分（仅英华，不进入作答流程）。
func (g *gateway) handleWorkResults(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	if se.info.Platform != "YINGHUA" {
		fail(w, http.StatusBadRequest, "作业状态与成绩查询暂仅支持英华学堂")
		return
	}
	var req struct {
		CourseID string `json:"courseId"`
		Works    []struct {
			WorkID string `json:"workId"`
			NodeID string `json:"nodeId"`
		} `json:"works"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Works) == 0 {
		fail(w, http.StatusBadRequest, "缺少作业列表")
		return
	}
	if len(req.Works) > 30 {
		fail(w, http.StatusBadRequest, "单次最多查询 30 份作业")
		return
	}
	keys := make([]yhExamKey, 0, len(req.Works))
	for _, wk := range req.Works {
		keys = append(keys, yhExamKey{ExamID: wk.WorkID, NodeID: wk.NodeID})
	}
	results, err := RunWorkResultsWithCreds(r.Context(), se.client.Session(), se.yhUsername, se.yhPassword, keys)
	if err != nil {
		fail(w, mapStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": results})
}

// ---------- 日志 ----------

func (g *gateway) handleRecentLogs(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": se.logs.recent()})
}

// handleLogStream 以 SSE 推送会话日志：先回放环形缓冲，再流式追加。
func (g *gateway) handleLogStream(w http.ResponseWriter, r *http.Request) {
	se, ok := g.sessionFrom(r)
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch, cancel := se.logs.subscribe()
	defer cancel()

	for _, entry := range se.logs.recent() { // 回放（可能与流式首条少量重复，可接受）
		writeSSE(w, entry)
	}
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		case entry, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, entry)
			flusher.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, entry logEntry) {
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_, _ = w.Write([]byte("data: " + string(data) + "\n\n"))
}

// ---------- JSON / 错误工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		fail(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

// mapStatus 把 core 的结构化错误映射为 HTTP 状态码。
func mapStatus(err error) int {
	switch {
	case errors.Is(err, yatori.ErrInvalidArgument):
		return http.StatusBadRequest
	case errors.Is(err, yatori.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, yatori.ErrNotLoggedIn):
		return http.StatusConflict
	case errors.Is(err, yatori.ErrUnsupported):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}
