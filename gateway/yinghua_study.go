package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	yatori "github.com/yatori-dev/yatori-go-core"
)

const yinghuaStudyPath = "/api/node/study.json"

// studyIDFor 取该节点当前的学习分配 ID；首次提交固定为 "0"（对齐 console）。
func (s *session) studyIDFor(nodeID string) string {
	s.studyMu.Lock()
	defer s.studyMu.Unlock()
	if s.studyIDs == nil {
		s.studyIDs = map[string]string{}
	}
	id := s.studyIDs[nodeID]
	if id == "" {
		id = "0"
	}
	return id
}

// setStudyIDFor 记录平台返回的 studyId，后续提交必须复用，进度才会累计。
func (s *session) setStudyIDFor(nodeID, id string) {
	if nodeID == "" || id == "" {
		return
	}
	s.studyMu.Lock()
	defer s.studyMu.Unlock()
	if s.studyIDs == nil {
		s.studyIDs = map[string]string{}
	}
	s.studyIDs[nodeID] = id
}

// resetStudyIDFor 每次开始刷一个节点时重置，等价于 console 里每个节点局部变量
// studyId = "0"，避免把上一次会话的 ID 带到新的提交链路。
func (s *session) resetStudyIDFor(nodeID string) {
	s.studyMu.Lock()
	defer s.studyMu.Unlock()
	if s.studyIDs != nil {
		delete(s.studyIDs, nodeID)
	}
}

// studyYingHua 复刻 console 的学时提交链路：
// 1. 首次提交 studyId = "0"，平台分配一个学习会话 ID；
// 2. 成功后从 result.data.studyId 取出 ID，后续每次提交都带上；
// 3. 只有复用同一个 studyId，平台才会把学时累加到同一个进度上。
//
// SDK 适配器把 studyId 写死成 "0"，每次都开新会话，所以面板日志显示提交成功，
// 但平台侧进度始终不动。英华平台在这里改走网关直连。
func studyYingHua(
	ctx context.Context,
	se *session,
	req studyRequest,
) (*yatori.StudyResult, error) {
	position := int(req.PositionSeconds)
	if req.Action == string(yatori.StudyActionFinish) {
		position = int(req.DurationSeconds)
	}
	if position < 0 {
		position = 0
	}
	duration := int(req.DurationSeconds)
	if duration > 0 && position > duration {
		position = duration
	}

	result := &yatori.StudyResult{
		CourseID: req.CourseID,
		NodeID:   req.NodeID,
		Kind:     yatori.NodeVideo,
		Position: time.Duration(position) * time.Second,
	}

	// start 只重置学习会话，不提交学时（console 也没有 start 请求）
	if req.Action == string(yatori.StudyActionStart) {
		se.resetStudyIDFor(req.NodeID)
		result.Message = "已就绪"
		result.Raw = "start"
		return result, nil
	}

	studyID := se.studyIDFor(req.NodeID)
	body, err := se.postYingHuaStudyTime(ctx, req.NodeID, studyID, position)
	if err != nil {
		return nil, err
	}

	msg := body
	var resp struct {
		Msg    string `json:"msg"`
		Result struct {
			Data struct {
				StudyID json.RawMessage `json:"studyId"`
			} `json:"data"`
		} `json:"result"`
	}
	if json.Unmarshal([]byte(body), &resp) == nil {
		if resp.Msg != "" {
			msg = resp.Msg
		}
		if id := studyIDFromJSON(resp.Result.Data.StudyID); id != "" {
			se.setStudyIDFor(req.NodeID, id)
		}
	}

	result.Submitted = strings.Contains(msg, "提交学时成功")
	result.Message = msg
	result.Raw = body
	if duration > 0 {
		result.Progress = float64(position) / float64(duration) * 100
		if result.Progress > 100 {
			result.Progress = 100
		}
		result.Completed = position >= duration
	}
	return result, nil
}

func (s *session) postYingHuaStudyTime(
	ctx context.Context,
	nodeID string,
	studyID string,
	studyTime int,
) (string, error) {
	if s.baseURL == "" || s.token == "" {
		return "", fmt.Errorf("英华会话缺少地址或 token")
	}
	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)
	fields := [][2]string{
		{"platform", "Android"},
		{"version", "1.4.8"},
		{"nodeId", nodeID},
		{"token", s.token},
		{"terminal", "Android"},
		{"studyTime", strconv.Itoa(studyTime)},
		{"studyId", studyID},
	}
	for _, f := range fields {
		if err := writer.WriteField(f[0], f[1]); err != nil {
			return "", err
		}
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		"POST",
		strings.TrimRight(s.baseURL, "/")+yinghuaStudyPath,
		payload,
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "Mozilla/5.0")
	if s.cookieHeader != "" {
		req.Header.Set("Cookie", s.cookieHeader)
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8192))
	if err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK {
		return string(body), fmt.Errorf("英华学时接口返回 HTTP %d", res.StatusCode)
	}
	return string(body), nil
}

func studyIDFromJSON(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var num float64
	if err := json.Unmarshal(raw, &num); err == nil {
		return strconv.FormatInt(int64(num), 10)
	}
	var str string
	if err := json.Unmarshal(raw, &str); err == nil {
		return str
	}
	return ""
}
