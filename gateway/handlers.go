package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	yatori "github.com/yatori-dev/yatori-go-core"
)

type gateway struct {
	store     *sessionStore
	platforms []platformMeta
}

func registerRoutes(mux *http.ServeMux, store *sessionStore) {
	g := &gateway{store: store, platforms: buildPlatformMeta()}

	mux.HandleFunc("GET /api/v1/health", g.handleHealth)
	mux.HandleFunc("GET /api/v1/platforms", g.handlePlatforms)
	mux.HandleFunc("POST /api/v1/sessions", g.handleCreateSession)
	mux.HandleFunc("GET /api/v1/sessions", g.handleListSessions)
	mux.HandleFunc("GET /api/v1/sessions/{id}", g.handleSessionInfo)
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", g.handleCloseSession)

	mux.HandleFunc("GET /api/v1/sessions/{id}/courses", g.handleCourses)
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/tree", g.handleTree)
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/works", g.handleWorks)
	mux.HandleFunc("GET /api/v1/sessions/{id}/courses/{courseId}/exams", g.handleExams)

	mux.HandleFunc("POST /api/v1/sessions/{id}/study", g.handleStudy)
	mux.HandleFunc("POST /api/v1/sessions/{id}/works/do", g.handleDoWork)
	mux.HandleFunc("POST /api/v1/sessions/{id}/exams/do", g.handleDoExam)

	mux.HandleFunc("GET /api/v1/sessions/{id}/logs", g.handleLogStream)
	mux.HandleFunc("GET /api/v1/sessions/{id}/logs/recent", g.handleRecentLogs)
}

// ---------- 基础 ----------

func (g *gateway) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]string{"status": "up", "service": "yatori-gateway"}})
}

func (g *gateway) handlePlatforms(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": g.platforms})
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
	Platform            string  `json:"platform"`
	Username            string  `json:"username"`
	Password            string  `json:"password"`
	URL                 string  `json:"url"`
	School              string  `json:"school"`
	Cookie              string  `json:"cookie"` // 支持 Cookie 登录的平台可用其代替账密
	ProxyURL            string  `json:"proxyURL"`
	LoginTimeoutSeconds int     `json:"loginTimeoutSeconds"`
	AI                  *aiConfigDTO   `json:"ai"`
	QuestionBank        *bankDTO       `json:"questionBank"`
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

	timeout := time.Duration(req.LoginTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 90 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if req.Cookie != "" {
		err = client.LoginWithCookie(ctx, req.Cookie)
	} else {
		err = client.Login(ctx)
	}
	if err != nil {
		_ = client.Close()
		// 带上最近日志（含验证码 OCR 过程），便于前端直接展示失败原因
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": err.Error(),
			"logs":  logger.recent(),
		})
		return
	}

	se := &session{
		info: sessionInfo{
			ID:           newID(),
			Platform:     platform.String(),
			PlatformName: platform.Description(),
			Account:      req.Username,
			Capabilities: capsToStrings(client.Capabilities()),
			CreatedAt:    time.Now().Format(time.RFC3339),
		},
		client: client,
		logs:   logger,
	}
	g.store.put(se)
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
		"info":    se.info,
		"session": se.client.Session(),
	}})
}

func (g *gateway) handleCloseSession(w http.ResponseWriter, r *http.Request) {
	se, ok := g.store.remove(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "session not found")
		return
	}
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
	courses, err := se.client.Courses(r.Context())
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
	tree, err := se.client.Tree(r.Context(), yatori.Course{ID: r.PathValue("courseId")})
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
	works, err := se.client.Works(r.Context(), yatori.Course{ID: r.PathValue("courseId")})
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
	exams, err := se.client.Exams(r.Context(), yatori.Course{ID: r.PathValue("courseId")})
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

// ---------- 学习 / 答题 ----------

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

	// 只传 ID：适配器会回查内部缓存（前提：先调过 Tree / Works）。
	result, err := se.client.Study(r.Context(), yatori.StudyRequest{
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
	result, err := se.client.DoWork(r.Context(), yatori.WorkRequest{
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
	result, err := se.client.DoExam(r.Context(), yatori.ExamRequest{
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
