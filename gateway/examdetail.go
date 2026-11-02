package main

// 英华考试/作业的「逐题模式」：绕过 SDK 聚合层黑盒（DoExam 一次性跑完
// 整个答题循环、过程日志走全局控制台、AnswerResult.Answers 不填充），
// 基于 core.Session 凭据直接复刻底层 HTTP 协议，实现：
//   - 逐题进度经 onProgress 回调实时上报（面板 SSE 展示）
//   - 返回逐题答案明细（供智能交卷的留空检测真正生效）
//
// 协议参考 yatori-go-core internal/api/yinghua（internal 包无法 import，
// 此处按相同报文形态复刻；题库请求与答案相似度匹配用公开包 que-core/qutils）。

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/thedevsaddam/gojsonq"
	"github.com/yatori-dev/yatori-go-core/core"
	"github.com/yatori-dev/yatori-go-core/que-core/external"
	"github.com/yatori-dev/yatori-go-core/que-core/qentity"
	"github.com/yatori-dev/yatori-go-core/que-core/qtype"
	"github.com/yatori-dev/yatori-go-core/utils/qutils"
)

// examProgress 单题进度事件（SSE 逐题推送）。
type examProgress struct {
	Index    int      `json:"index"`              // 第几题（1 起）
	Total    int      `json:"total"`              // 总题数
	Type     string   `json:"type"`               // 题型（单选题/多选题/…）
	Content  string   `json:"content"`            // 题面（截断）
	Answer   []string `json:"answer"`             // 转换后的最终答案（选项字母/文本）
	Blank    bool     `json:"blank"`              // 是否留空（题库未命中且为填空/简答）
	Hit      bool     `json:"hit"`                // 题库是否命中（answers 非空）
	SavedMsg string   `json:"savedMsg,omitempty"` // 平台保存响应摘要
	Err      string   `json:"err,omitempty"`      // 本题异常（不中断整体）
}

// examDetailAnswer 逐题明细，最终随结果返回。
type examDetailAnswer struct {
	Index   int      `json:"index"`
	Type    string   `json:"type"`
	Content string   `json:"content"`
	Value   []string `json:"value"`
	Blank   bool     `json:"blank"`
	Hit     bool     `json:"hit"`
}

type examDetailResult struct {
	Submitted bool               `json:"submitted"`
	Total     int                `json:"total"`
	Answered  int                `json:"answered"`
	Blank     int                `json:"blank"`
	Answers   []examDetailAnswer `json:"answers"`
}

// yhCreds 从网关会话快照还原英华底层凭据。
type yhCreds struct {
	baseURL string
	token   string
	cookie  string
}

func newYhCreds(sess core.Session) (yhCreds, error) {
	base := sess.Extra["url"]
	if base == "" {
		return yhCreds{}, fmt.Errorf("会话缺少站点地址")
	}
	cookie := sess.Cookie
	if cookie == "" && sess.Token != "" {
		cookie = "token=" + sess.Token
	}
	if cookie == "" {
		return yhCreds{}, fmt.Errorf("会话缺少凭据，请重新登录")
	}
	return yhCreds{baseURL: strings.TrimRight(base, "/"), token: sess.Token, cookie: cookie}, nil
}

func (c yhCreds) httpClient() *http.Client {
	tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	return &http.Client{Timeout: 30 * time.Second, Transport: tr}
}

// startExam GET /api/exam/start.json —— 进入考试。
func (c yhCreds) startExam(ctx context.Context, courseId, nodeId, examId string) (string, error) {
	url := fmt.Sprintf("%s/api/exam/start.json?nodeId=%s&courseId=%s&token=%s&examId=%s",
		c.baseURL, nodeId, courseId, c.token, examId)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Cookie", c.cookie)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// fetchTopics POST /api/exam.json —— 拉取试卷 HTML 并解析为题目列表。
func (c yhCreds) fetchTopics(ctx context.Context, nodeId, examId string) ([]yhTopic, error) {
	url := fmt.Sprintf("%s/api/exam.json?nodeId=%s&examId=%s&token=%s", c.baseURL, nodeId, examId, c.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader("{}"))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Cookie", c.cookie)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return parseYhExamTopics(string(body)), nil
}

// submitQuestion POST /api/exam/submit.json —— 保存单题（finish=1 时交卷）。
func (c yhCreds) submitQuestion(ctx context.Context, examId, answerId string, q qentity.Question, finish string) (string, error) {
	payload := &strings.Builder{}
	payload.WriteString("--boundary-yatori\r\n")
	writeField := func(name, value string) {
		payload.WriteString(fmt.Sprintf("Content-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n", name, value))
	}
	writeField("platform", "Android")
	writeField("version", "1.4.8")
	writeField("examId", examId)
	writeField("terminal", "Android")
	writeField("answerId", answerId)
	writeField("finish", finish)
	writeField("token", c.token)
	// 单选/判断/简答：单值 answer；多选：answer[]；填空：answer_N
	switch q.Type {
	case qtype.SingleChoice.String(), qtype.TrueOrFalse.String(), qtype.ShortAnswer.String():
		if len(q.Answers) > 0 {
			writeField("answer", q.Answers[0])
		}
	case qtype.MultipleChoice.String():
		for _, v := range q.Answers {
			writeField("answer[]", v)
		}
	case qtype.FillInTheBlank.String():
		for i, v := range q.Answers {
			writeField("answer_"+strconv.Itoa(i+1), v)
		}
	}
	payload.WriteString("--boundary-yatori--\r\n")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/exam/submit.json", c.baseURL), strings.NewReader(payload.String()))
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary-yatori")
	req.Header.Set("Cookie", c.cookie)
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// ---------- HTML → 题目（复刻 TurnExamTopic） ----------

type yhTopic struct {
	AnswerID string
	Index    string
	Question qentity.Question
}

var (
	yhTopicIDRe   = regexp.MustCompile(`<li>[ \f\n\r\t\v]*<a data-id="([^"]*)"[ \f\n\r\t\v]*href="[^"]*"[ \f\n\r\t\v]*class="[^"]*"[ \f\n\r\t\v]*id="[^"]*"[ \f\n\r\t\v]*data-index="[^"]*"[ \f\n\r\t\v]*onclick="[^"]*">([^<]*)</a>[ \f\n\r\t\v]*</li>`)
	yhFormRe      = regexp.MustCompile(`<form method="post" action="/api/[^/]+/submit">([\w\W]*?)</form>`)
	yhNumRe       = regexp.MustCompile(`<span class="num">[\D]*?([\d]+)`)
	yhTagRe       = regexp.MustCompile(`<span class="tag">([\s\S]*?)</span>`)
	yhContentRe   = regexp.MustCompile(`<div[ \f\n\r\t\v]*class="content"[ \f\n\r\t\v]*style="[^"]*">([\s\S]*?)</div>`)
	yhSelectRe    = regexp.MustCompile(`<li>[^<]*<label>[^<]*<input type="[^"]*"[^v]*value="([^"]*)"[ \f\n\r\t\v]*[checked="checked"]*[ \f\n\r\t\v]*class="[^"]*"[ \f\n\r\t\v]*name="[^"]*">[ \f\n\r\t\v]*<span class="num">([^<]*)</span>[ \f\n\r\t\v]*<span[ \f\n\r\t\v]*class="txt">([^<]*)</span>[ \f\n\r\t\v]*</label>[ \f\n\r\t\v]*</li>`)
	yhFillRe      = regexp.MustCompile(`<input class="[^"]*" autocomplete="[^"]*" autocomplete="[^"]*" type="[^"]*" style="[^"]*" name="answer_([^"]*)" value="[^"]*"/>`)
	yhScoreRe     = regexp.MustCompile(`<span[ \f\n\r\t\v]*class="txt">[^\d]*([\d]*)[^分]*分[^<]*</span>`)
)

// parseYhExamTopics 把试卷 HTML 解析为题目列表（对齐 SDK 的 TurnExamTopic）。
func parseYhExamTopics(html string) []yhTopic {
	topicMap := map[string]string{}
	for _, m := range yhTopicIDRe.FindAllStringSubmatch(html, -1) {
		topicMap[m[2]] = m[1]
	}
	out := make([]yhTopic, 0)
	for _, form := range yhFormRe.FindAllStringSubmatch(html, -1) {
		frag := form[1]
		num := ""
		if m := yhNumRe.FindStringSubmatch(frag); m != nil {
			num = m[1]
		}
		tag := ""
		if m := yhTagRe.FindStringSubmatch(frag); m != nil {
			tag = strings.TrimSpace(m[1])
		}
		content := ""
		var options []string
		if m := yhContentRe.FindStringSubmatch(frag); m != nil {
			content = m[1]
		}
		switch tag {
		case "单选", "多选", "判断":
			for _, sm := range yhSelectRe.FindAllStringSubmatch(frag, -1) {
				options = append(options, sm[3])
			}
		case "填空":
			for _, fm := range yhFillRe.FindAllStringSubmatch(frag, -1) {
				options = append(options, fm[1])
			}
		}
		content = strings.NewReplacer("<p>", "", "</p>", "\n", "&nbsp;", "").Replace(content)
		for i := range options {
			options[i] = strings.ReplaceAll(options[i], "&quot;", "\"")
		}
		out = append(out, yhTopic{
			AnswerID: topicMap[num],
			Index:    num,
			Question: qentity.Question{Type: yhTurnType(tag), Content: content, Options: options},
		})
	}
	return out
}

func yhTurnType(origin string) string {
	switch origin {
	case "单选":
		return qtype.SingleChoice.String()
	case "多选":
		return qtype.MultipleChoice.String()
	case "判断":
		return qtype.TrueOrFalse.String()
	case "填空":
		return qtype.FillInTheBlank.String()
	case "简答":
		return qtype.ShortAnswer.String()
	}
	return "其他"
}

// ---------- 答案转换（复刻 answerTurnResult） ----------

// convertAnswers 把题库返回的答案文本转换为平台接受的提交值：
// 选择/判断 → 选项字母（相似度匹配，多选去重）；填空/简答 → 原文。
func convertAnswers(q *qentity.Question) []string {
	out := make([]string, 0)
	if q.Type == qtype.SingleChoice.String() || q.Type == qtype.TrueOrFalse.String() || q.Type == qtype.MultipleChoice.String() {
		var res []string
		letters := []string{"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "R", "M", "N", "O", "P", "Q"}
		for _, item := range q.Answers {
			pick := ""
			best := 0.0
			for i, opt := range q.Options {
				if score := qutils.Similarity(opt, item); score > best && !containsStr(res, letters[i]) {
					best = score
					pick = letters[i]
				}
			}
			if pick != "" {
				res = append(res, pick)
			}
		}
		out = res
	} else {
		out = append(out, q.Answers...)
	}
	return out
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// RunExamDetail 逐题执行一场英华考试（或作业，协议一致仅接口不同——当前考试用）。
// onProgress 每题回调一次。
// submitMode：off=仅保存；direct=保存后交卷；smart=有留空不交卷。
func RunExamDetail(
	ctx context.Context,
	sess core.Session,
	courseID, examID, nodeID, bankURL, submitMode string,
	onProgress func(examProgress),
) (*examDetailResult, error) {
	creds, err := newYhCreds(sess)
	if err != nil {
		return nil, err
	}

	start, err := creds.startExam(ctx, courseID, nodeID, examID)
	if err != nil {
		return nil, fmt.Errorf("进入考试失败: %w", err)
	}
	if code := gojsonq.New().JSONString(start).Find("_code"); code != nil {
		if fc, ok := code.(float64); ok && fc == 9 {
			msg, _ := gojsonq.New().JSONString(start).Find("msg").(string)
			return nil, fmt.Errorf("%s", msg)
		}
	}

	topics, err := creds.fetchTopics(ctx, nodeID, examID)
	if err != nil {
		return nil, fmt.Errorf("拉取试卷失败: %w", err)
	}
	if len(topics) == 0 {
		return nil, fmt.Errorf("试卷解析为空（可能已交过或已过期）")
	}

	result := &examDetailResult{Total: len(topics), Answers: make([]examDetailAnswer, 0, len(topics))}
	var lastTopic yhTopic
	for i, t := range topics {
		lastTopic = t
		p := examProgress{Index: i + 1, Total: len(topics), Type: t.Question.Type}
		if len(t.Question.Content) > 80 {
			p.Content = t.Question.Content[:80]
		} else {
			p.Content = t.Question.Content
		}

		// 题库取答案（失败/未命中不中断，按留空处理——对齐 SDK 行为但不随机兜底）
		var bankAns *qentity.ResultQuestion
		if bankURL != "" {
			bankAns, err = external.ApiQueRequest(t.Question, bankURL, 3, nil)
			if err != nil {
				p.Err = "题库请求失败: " + err.Error()
			}
		}
		if bankAns != nil && len(bankAns.Answers) > 0 {
			p.Hit = true
			t.Question.Answers = convertAnswers(&bankAns.Question)
		} else if bankAns != nil && bankAns.Question.Answers != nil {
			// 部分题库把答案放在 Question.Answers
			t.Question.Answers = convertAnswers(&bankAns.Question)
		}
		if len(t.Question.Answers) == 0 {
			p.Blank = true
			result.Blank++
		}

		result.Answered++
		p.Answer = t.Question.Answers
		if saved, err := creds.submitQuestion(ctx, examID, t.AnswerID, t.Question, "0"); err != nil {
			p.Err = "保存失败: " + err.Error()
		} else {
			msg := gojsonq.New().JSONString(saved).Find("msg")
			if s, ok := msg.(string); ok {
				p.SavedMsg = s
			} else {
				p.SavedMsg = strings.TrimSpace(saved)
				if len(p.SavedMsg) > 60 {
					p.SavedMsg = p.SavedMsg[:60]
				}
			}
		}
		result.Answers = append(result.Answers, examDetailAnswer{
			Index: i + 1, Type: t.Question.Type, Content: p.Content,
			Value: t.Question.Answers, Blank: p.Blank, Hit: p.Hit,
		})
		if onProgress != nil {
			onProgress(p)
		}
	}

	// 交卷判定：direct 直接交；smart 有留空跳过；off 不交。
	// 交卷（finish=1，复用最后一题的 answerId——对齐 SDK）
	shouldSubmit := submitMode == "direct" || (submitMode == "smart" && result.Blank == 0)
	if shouldSubmit {
		saved, err := creds.submitQuestion(ctx, examID, lastTopic.AnswerID, lastTopic.Question, "1")
		if err != nil {
			return result, fmt.Errorf("交卷失败: %w", err)
		}
		msg, _ := gojsonq.New().JSONString(saved).Find("msg").(string)
		if msg != "提交试卷成功" {
			return result, fmt.Errorf("交卷未确认: %s", msg)
		}
		result.Submitted = true
	}
	return result, nil
}

// examNodeID 从考试 DTO extra 中取 nodeId。
func examNodeID(extra map[string]string) string { return extra["nodeId"] }
