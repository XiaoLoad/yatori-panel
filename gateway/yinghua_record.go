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
)

// yinghuaRecord 单个视频节点在平台侧的最新观看状态（/api/record/video.json 条目）。
type yinghuaRecord struct {
	Progress       float64 `json:"progress"`        // 观看进度 0-100
	ViewedDuration int     `json:"viewedDuration"`  // 已看秒数
	State          int     `json:"state"`           // 平台节点状态
}

/**
 * fetchYinghuaRecords 拉取某课程在平台侧的最新视频观看记录（分页抓全）。
 *
 * SDK 适配器把章节树缓存在会话对象里且无失效接口（treeLocked 命中即返回），
 * 而面板会跨任务复用在线会话——第二次发起任务时 Tree 返回的仍是上次任务
 * 开始前的快照（viewedSeconds=0、未完成），导致已刷完的节点被从 0 重新提交。
 *
 * console 的做法是每轮运行都现场调观看记录接口（VideosListAction →
 * VideWatchRecodeApi 分页），以平台侧的 progress/viewedDuration 为准跳过
 * 已完成节点。这里复刻同一数据源，供 handleTree 在返回前刷新缓存值。
 *
 * 拉取失败返回错误（上层降级为直接用 SDK 缓存，不阻塞刷课）。
 */
func fetchYinghuaRecords(
	ctx context.Context,
	se *session,
	courseID string,
) (map[string]yinghuaRecord, error) {
	if se.baseURL == "" || se.token == "" {
		return nil, fmt.Errorf("英华会话缺少地址或 token")
	}

	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}

	out := map[string]yinghuaRecord{}
	// 记录接口分页返回（pageSize 10），pageCount 由首页给出；防御上限 200 页
	for page := 1; page <= 200; page++ {
		body, err := postYinghuaRecordPage(ctx, client, se, courseID, page)
		if err != nil {
			return nil, err
		}

		var resp struct {
			Msg    string `json:"msg"`
			Result struct {
				List     []yinghuaRecordEntry `json:"list"`
				PageInfo *struct {
					PageCount int `json:"pageCount"`
				} `json:"pageInfo"`
			} `json:"result"`
		}
		if err := json.Unmarshal([]byte(body), &resp); err != nil {
			return nil, fmt.Errorf("观看记录响应解析失败：%w", err)
		}
		if resp.Msg != "" && resp.Msg != "获取数据成功" {
			return nil, fmt.Errorf("观看记录接口返回：%s", resp.Msg)
		}

		for _, entry := range resp.Result.List {
			out[entry.NodeID()] = yinghuaRecord{
				Progress:       entry.Progress,
				ViewedDuration: entry.ViewedDuration,
				State:          entry.State,
			}
		}

		if resp.Result.PageInfo == nil || resp.Result.PageInfo.PageCount <= page {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("观看记录为空")
	}
	return out, nil
}

// yinghuaRecordEntry 兼容 id 为数字（移动端接口）或字符串（PC 接口）两种形态。
type yinghuaRecordEntry struct {
	ID             json.RawMessage `json:"id"`
	Progress       float64         `json:"progress"`
	ViewedDuration int             `json:"viewedDuration"`
	State          int             `json:"state"`
}

func (e yinghuaRecordEntry) NodeID() string {
	if len(e.ID) == 0 {
		return ""
	}
	var num float64
	if err := json.Unmarshal(e.ID, &num); err == nil {
		return strconv.FormatInt(int64(num), 10)
	}
	var str string
	if err := json.Unmarshal(e.ID, &str); err == nil {
		return str
	}
	return ""
}

func postYinghuaRecordPage(
	ctx context.Context,
	client *http.Client,
	se *session,
	courseID string,
	page int,
) (string, error) {
	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)
	fields := [][2]string{
		{"platform", "Android"},
		{"version", "1.4.8"},
		{"token", se.token},
		{"courseId", courseID},
		{"page", strconv.Itoa(page)},
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
		strings.TrimRight(se.baseURL, "/")+"/api/record/video.json",
		payload,
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "Mozilla/5.0")
	if se.cookieHeader != "" {
		req.Header.Set("Cookie", se.cookieHeader)
	}

	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK {
		return string(body), fmt.Errorf("观看记录接口返回 HTTP %d", res.StatusCode)
	}
	return string(body), nil
}
