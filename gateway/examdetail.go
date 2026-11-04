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
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Changbaiqi/ddddocr-go/utils"
	"github.com/thedevsaddam/gojsonq"
	"github.com/yatori-dev/yatori-go-core/core"
	"github.com/yatori-dev/yatori-go-core/que-core/external"
	"github.com/yatori-dev/yatori-go-core/que-core/qentity"
	"github.com/yatori-dev/yatori-go-core/que-core/qtype"
	"github.com/yatori-dev/yatori-go-core/utils/qutils"
	ort "github.com/yalue/onnxruntime_go"
)

// ddddocr 是 ddddocr-go/utils 的别名（与 SDK 同款验证码 OCR）。
var ddddocr = utilsPackage{}

// utilsPackage 提供 SemiOCRVerification 的初始化保证（OCR 引擎只初始化一次）。
type utilsPackage struct{}

var ocrOnce sync.Once

func (utilsPackage) SemiOCRVerification(img image.Image, shape ort.Shape) string {
	ocrOnce.Do(func() {
		// SDK 登录面板会话时可能已调用 EnsureOCR 初始化过 onnxruntime；
		// 重复 InitializeEnvironment 会报错，这里仅在环境未初始化时执行。
		if !ort.IsInitialized() {
			utils.DDDDOcrCoreInit() // 释放内嵌动态库与模型到 ./assets 并初始化
		}
	})
	return utils.SemiOCRVerification(img, shape)
}

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

// errRelogin 平台返回登录超时——上层应重建会话后重试（server 侧按此错误触发 rebuildSession）。
var errRelogin = fmt.Errorf("账号登录超时，请重新登录")

// reloginRe 英华登录超时响应特征（逐题保存/进入考试均可能返回）。
var reloginRe = regexp.MustCompile(`账号登录超时`)

// checkRelogin 检测平台响应是否为登录超时；是则返回 errRelogin。
func checkRelogin(resp string) error {
	if reloginRe.MatchString(resp) {
		return errRelogin
	}
	return nil
}

// yhSession 英华自管理会话（方案 B）：不走 SDK 会话快照，而是像 console 一样
// 自己走「验证码 OCR → 登录」链路，持有完整的 Cookie 会话（验证码阶段下发的
// session + token）。平台对写接口（逐题保存）校验该 session 与 token 的绑定，
// 仅靠 token 快照会被拒「账号登录超时」；console 能跑通正是因为全程复用同一
// 条 Cookie 会话。登录超时时原地重登刷新凭据（对齐 console LoginTimeoutAfreshAction）。
type yhSession struct {
	mu      sync.Mutex // 仅保护 token/cookies 字段读写
	loginMu sync.Mutex // 串行化登录流程；不可与 mu 嵌套（sync.Mutex 不可重入，嵌套会死锁）
	baseURL string
	account string
	passwd  string
	token   string
	cookies string // 规范化 "name=value; name=value"（登录全链路累积）
	client  *http.Client
}

// yhSessionStore 按账号（baseURL+username）缓存 yhSession，登录一次全场复用。
var yhSessionStore = struct {
	sync.Mutex
	m map[string]*yhSession
}{m: map[string]*yhSession{}}

// getYhSession 取缓存的会话；没有则现场登录（验证码 OCR）。
// 登录期间不持有 store 锁（登录最坏要做多次验证码重试，持锁会阻塞同账号其他请求）。
func getYhSession(baseURL, account, passwd string) (*yhSession, error) {
	key := strings.TrimRight(baseURL, "/") + "|" + account
	yhSessionStore.Lock()
	cached, ok := yhSessionStore.m[key]
	yhSessionStore.Unlock()
	if ok {
		return cached, nil
	}

	s := &yhSession{
		baseURL: strings.TrimRight(baseURL, "/"),
		account: account,
		passwd:  passwd,
		client:  &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}},
	}
	if err := s.login(); err != nil {
		return nil, err
	}

	yhSessionStore.Lock()
	defer yhSessionStore.Unlock()
	// 并发场景下别的请求可能已经建好了，复用先到的
	if existing, ok := yhSessionStore.m[key]; ok {
		return existing, nil
	}
	yhSessionStore.m[key] = s
	return s, nil
}

// fetchCaptcha GET /service/code —— 获取验证码图片。
// 该接口下发的 Session Cookie 是后续所有请求的会话凭据（对齐 SDK：
// cache.cookies 只在此接口刷新，登录/考试/保存接口的 Set-Cookie 一律不合并）。
func (s *yhSession) fetchCaptcha(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/service/code?r=%.16f", s.baseURL, float64(time.Now().UnixNano())/1e9), nil)
	if err != nil {
		return nil, err
	}
	s.setHeaders(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	s.replaceCookies(resp)
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// login 验证码 OCR → 登录 → 提取 token。验证码有误自动重试（上限 5 次）。
// 用 loginMu 串行化登录流程；内部调用的 setHeaders/absorbCookies 会锁 mu，
// 因此 login 自身绝不能持有 mu（否则重入死锁）。
func (s *yhSession) login() error {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	for attempt := 0; attempt < 5; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		img, err := s.fetchCaptcha(ctx)
		cancel()
		if err != nil {
			return fmt.Errorf("获取验证码失败: %w", err)
		}
		code, err := ocrCaptcha(img)
		if err != nil {
			return fmt.Errorf("验证码识别失败: %w", err)
		}
		yhDebugLog("captcha fetched %d bytes, ocr=%q", len(img), code)

		// 登录用标准库 multipart（与 SDK LoginApi 完全一致的报文形态）
		payload := &bytes.Buffer{}
		writer := multipart.NewWriter(payload)
		_ = writer.WriteField("username", s.account)
		_ = writer.WriteField("password", s.passwd)
		_ = writer.WriteField("code", code)
		_ = writer.WriteField("redirect", s.baseURL)
		if err := writer.Close(); err != nil {
			return err
		}

		req, err := http.NewRequest(http.MethodPost, s.baseURL+"/user/login.json", payload)
		if err != nil {
			return err
		}
		s.setHeaders(req)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		resp, err := s.client.Do(req)
		if err != nil {
			return fmt.Errorf("登录请求失败: %w", err)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if err != nil {
			return err
		}

		// 调试：输出登录响应摘要（不含敏感字段），便于排查验证码/登录失败
		respSnippet := string(body)
		if len(respSnippet) > 200 {
			respSnippet = respSnippet[:200]
		}
		// 用 encoding/json 解析（gojsonq 实例复用 Find 的行为不稳定）
		var loginResp struct {
			Redirect string `json:"redirect"`
			Msg      string `json:"msg"`
			Status   bool   `json:"status"`
		}
		if err := json.Unmarshal(body, &loginResp); err != nil {
			yhDebugLog("attempt=%d 解析登录响应失败: %v resp=%s", attempt, err, respSnippet)
			continue
		}
		yhDebugLog("attempt=%d code=%q msg=%q redirect=%q status=%v", attempt, code, loginResp.Msg, loginResp.Redirect, loginResp.Status)
		if loginResp.Msg == "验证码有误！" {
			continue
		}
		if loginResp.Redirect == "" {
			if loginResp.Msg != "" {
				return fmt.Errorf("%s", loginResp.Msg)
			}
			continue
		}
		parts := strings.Split(loginResp.Redirect, "token=")
		if len(parts) < 2 {
			return fmt.Errorf("登录响应缺少 token: %s", loginResp.Redirect)
		}
		s.token = strings.Split(parts[1], "&")[0]
		return nil
	}
	return fmt.Errorf("登录失败：验证码连续识别错误")
}

// relogin 检测到登录超时后原地重登（对齐 console LoginTimeoutAfreshAction）。
// 注意：不持锁，登录串行化由 login 内部的 loginMu 负责（持 mu 会导致重入死锁）。
func (s *yhSession) relogin() error {
	return s.login()
}

// replaceCookies 用响应 Set-Cookie 覆盖会话 Cookie 串（对齐 SDK：只有验证码接口做这件事）。
func (s *yhSession) replaceCookies(resp *http.Response) {
	cs := resp.Cookies()
	if len(cs) == 0 {
		return
	}
	pairs := make([]string, 0, len(cs))
	for _, c := range cs {
		pairs = append(pairs, c.Name+"="+c.Value)
	}
	s.mu.Lock()
	s.cookies = strings.Join(pairs, "; ")
	s.mu.Unlock()
	names := make([]string, 0, len(cs))
	for _, c := range cs {
		names = append(names, c.Name)
	}
	yhDebugLog("captcha cookies: %s", strings.Join(names, ","))
}

// setHeaders 设置与 console 一致的公共请求头并附会话 Cookie。
func (s *yhSession) setHeaders(req *http.Request) {
	req.Header.Set("User-Agent", yhDefaultUA)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Connection", "keep-alive")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cookies != "" {
		req.Header.Set("Cookie", s.cookies)
	}
}

// yhDefaultUA 与 SDK utils.DefaultUserAgent 一致的完整浏览器 UA——
// 裸 "Mozilla/5.0" 可能触发平台风控导致写接口（submit）被拒。
const yhDefaultUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"

// yhCreds 凭据只读快照（token+cookie），请求构建用。
type yhCreds struct {
	baseURL string
	token   string
	cookie  string
}

// creds 取当前凭据快照（token+cookie），请求构建用。
func (s *yhSession) creds() yhCreds {
	s.mu.Lock()
	defer s.mu.Unlock()
	return yhCreds{baseURL: s.baseURL, token: s.token, cookie: s.cookies}
}

// startExam GET /api/exam/start.json —— 进入考试。
func (s *yhSession) startExam(ctx context.Context, courseId, nodeId, examId string) (string, error) {
	c := s.creds()
	url := fmt.Sprintf("%s/api/exam/start.json?nodeId=%s&courseId=%s&token=%s&examId=%s",
		c.baseURL, nodeId, courseId, c.token, examId)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	s.setHeaders(req)
	resp, err := s.client.Do(req)
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
func (s *yhSession) fetchTopics(ctx context.Context, nodeId, examId string) ([]yhTopic, error) {
	c := s.creds()
	url := fmt.Sprintf("%s/api/exam.json?nodeId=%s&examId=%s&token=%s", c.baseURL, nodeId, examId, c.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader("{}"))
	if err != nil {
		return nil, err
	}
	s.setHeaders(req)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := s.client.Do(req)
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
func (s *yhSession) submitQuestion(ctx context.Context, examId, answerId string, q qentity.Question, finish string) (string, error) {
	c := s.creds()
	// 必须用标准库 multipart：手写报文缺少各字段间的 "--boundary" 分隔，
	// 平台只会解析到第一个字段（token 丢失 → 恒返回「账号登录超时」）。
	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)
	_ = writer.WriteField("platform", "Android")
	_ = writer.WriteField("version", "1.4.8")
	_ = writer.WriteField("examId", examId)
	_ = writer.WriteField("terminal", "Android")
	_ = writer.WriteField("answerId", answerId)
	_ = writer.WriteField("finish", finish)
	_ = writer.WriteField("token", c.token)
	// 单选/判断/简答：单值 answer；多选：answer[]；填空：answer_N
	switch q.Type {
	case qtype.SingleChoice.String(), qtype.TrueOrFalse.String(), qtype.ShortAnswer.String():
		if len(q.Answers) > 0 {
			_ = writer.WriteField("answer", q.Answers[0])
		}
	case qtype.MultipleChoice.String():
		for _, v := range q.Answers {
			_ = writer.WriteField("answer[]", v)
		}
	case qtype.FillInTheBlank.String():
		for i, v := range q.Answers {
			_ = writer.WriteField("answer_"+strconv.Itoa(i+1), v)
		}
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/exam/submit.json", c.baseURL), payload)
	if err != nil {
		return "", err
	}
	s.setHeaders(req)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := s.client.Do(req)
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

// yhLetters 选项序号对应的提交值（对抗平台只接收 A/B/C…）。
var yhLetters = []string{"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"}

// mapAnswerTexts 把题库返回的答案文本映射为平台提交值。
// 关键：必须用「平台题目」的 Type/Options —— 题库返回的 Question 通常不带
// 题型与选项，若拿它判断，会把答案原文当提交值写入（平台匹配不到选项 → 保存为空答案）。
func mapAnswerTexts(pq *qentity.Question, texts []string) []string {
	switch pq.Type {
	case qtype.SingleChoice.String(), qtype.TrueOrFalse.String(), qtype.MultipleChoice.String():
		res := make([]string, 0, len(texts))
		for _, item := range texts {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			// 题库已直接返回字母（A/B/…）且落在选项范围内：原样使用
			if up := strings.ToUpper(item); len(up) == 1 && up[0] >= 'A' && up[0] <= 'Z' {
				if idx := int(up[0] - 'A'); idx < len(pq.Options) {
					if !containsStr(res, yhLetters[idx]) {
						res = append(res, yhLetters[idx])
					}
					continue
				}
			}
			// 文本 → 最相似的选项字母（0.3 阈值，避免把无关文案硬塞成 A）
			pick := ""
			best := 0.3
			for i, opt := range pq.Options {
				if i >= len(yhLetters) {
					break
				}
				if score := qutils.Similarity(opt, item); score >= best && !containsStr(res, yhLetters[i]) {
					best = score
					pick = yhLetters[i]
				}
			}
			if pick != "" {
				res = append(res, pick)
			} else {
				// 未匹配到选项：回落原文（至少不吞掉答案），并留痕便于排查
				yhDebugLog("答案未匹配到选项 type=%s options=%d item=%q", pq.Type, len(pq.Options), item)
				res = append(res, item)
			}
		}
		return res
	default:
		// 填空/简答直接提交原文
		return texts
	}
}

func containsStr(list []string, s string) bool {
	return slices.Contains(list, s)
}

// yhDebugLog 调试日志落盘（gateway 同目录 yh-login.log），便于排查 OCR/登录问题。
func yhDebugLog(format string, args ...any) {
	// 默认关闭，排查问题前设置 YH_DEBUG=1 再启动 gateway
	if os.Getenv("YH_DEBUG") == "" {
		return
	}
	f, err := os.OpenFile("yh-login.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, time.Now().Format("[2006-01-02 15:04:05] ")+format+"\n", args...)
}

// ocrCaptcha 用 ddddocr（与 SDK 同款内嵌模型）识别验证码图片。
func ocrCaptcha(imgBytes []byte) (string, error) {
	img, err := png.Decode(bytes.NewReader(imgBytes))
	if err != nil {
		return "", err
	}
	// 英华验证码输出宽度上限 18 字符（对齐 SDK YingHuaLoginAction 的 SemiOCRVerification）
	return ddddocr.SemiOCRVerification(img, ort.NewShape(1, 18)), nil
}

// RunExamDetailWithCreds 带账号凭据的逐题执行（account/passwd 为英华登录凭据）。
// onProgress 每题回调一次；submitMode：off=仅保存 / direct=保存后交卷 / smart=有留空不交卷。
func RunExamDetailWithCreds(
	ctx context.Context,
	sess core.Session,
	account, passwd string,
	courseID, examID, nodeID, bankURL, submitMode string,
	onProgress func(examProgress),
) (*examDetailResult, error) {
	base := sess.Extra["url"]
	if base == "" {
		return nil, fmt.Errorf("会话缺少站点地址")
	}
	if account == "" || passwd == "" {
		return nil, fmt.Errorf("缺少英华登录凭据（账号/密码），无法建立逐题会话")
	}
	sess2, err := getYhSession(base, account, passwd)
	if err != nil {
		return nil, fmt.Errorf("建立英华会话失败: %w", err)
	}

	start, err := sess2.startExam(ctx, courseID, nodeID, examID)
	if err != nil {
		return nil, fmt.Errorf("进入考试失败: %w", err)
	}
	if code := gojsonq.New().JSONString(start).Find("_code"); code != nil {
		if fc, ok := code.(float64); ok && fc == 9 {
			msg, _ := gojsonq.New().JSONString(start).Find("msg").(string)
			return nil, fmt.Errorf("%s", msg)
		}
	}
	if err := checkRelogin(start); err != nil {
		// 进入考试即报登录超时：原地重登一次再试
		if rerr := sess2.relogin(); rerr != nil {
			return nil, fmt.Errorf("登录超时且重登失败: %w", rerr)
		}
		start, err = sess2.startExam(ctx, courseID, nodeID, examID)
		if err != nil {
			return nil, fmt.Errorf("重登后进入考试失败: %w", err)
		}
		if code := gojsonq.New().JSONString(start).Find("_code"); code != nil {
			if fc, ok := code.(float64); ok && fc == 9 {
				msg, _ := gojsonq.New().JSONString(start).Find("msg").(string)
				return nil, fmt.Errorf("%s", msg)
			}
		}
		if err := checkRelogin(start); err != nil {
			return nil, err
		}
	}

	topics, err := sess2.fetchTopics(ctx, nodeID, examID)
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
			t.Question.Answers = mapAnswerTexts(&t.Question, bankAns.Answers)
		} else if bankAns != nil && bankAns.Question.Answers != nil {
			// 部分题库把答案放在 Question.Answers
			t.Question.Answers = mapAnswerTexts(&t.Question, bankAns.Question.Answers)
		}
		if len(t.Question.Answers) == 0 {
			p.Blank = true
			result.Blank++
		}

		result.Answered++
		p.Answer = t.Question.Answers
		if saved, err := sess2.submitQuestion(ctx, examID, t.AnswerID, t.Question, "0"); err != nil {
			p.Err = "保存失败: " + err.Error()
		} else {
			if rerr := checkRelogin(saved); rerr != nil {
				// 登录超时：原地重登刷新凭据后重试本题（对齐 console LoginTimeoutAfreshAction）
				if lerr := sess2.relogin(); lerr != nil {
					p.Err = "保存失败且重登失败: " + lerr.Error()
					result.Answers = append(result.Answers, examDetailAnswer{
						Index: i + 1, Type: t.Question.Type, Content: p.Content,
						Value: t.Question.Answers, Blank: p.Blank, Hit: p.Hit,
					})
					if onProgress != nil {
						onProgress(p)
					}
					return result, lerr
				}
				saved, err = sess2.submitQuestion(ctx, examID, t.AnswerID, t.Question, "0")
				if err != nil {
					p.Err = "重登后保存失败: " + err.Error()
				} else if rerr := checkRelogin(saved); rerr != nil {
					// 重登后仍超时：终止本场
					p.Err = "保存失败: " + rerr.Error()
					result.Answers = append(result.Answers, examDetailAnswer{
						Index: i + 1, Type: t.Question.Type, Content: p.Content,
						Value: t.Question.Answers, Blank: p.Blank, Hit: p.Hit,
					})
					if onProgress != nil {
						onProgress(p)
					}
					return result, rerr
				}
			}
			if err == nil {
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
		saved, err := sess2.submitQuestion(ctx, examID, lastTopic.AnswerID, lastTopic.Question, "1")
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

// ---------- 考试结果只读查询（英华） ----------

// yhExamResult 单场考试状态：只读取平台成绩页，不进入考试、不提交、不消耗答题次数。
type yhExamResult struct {
	ExamID    string   `json:"examId"`
	NodeID    string   `json:"nodeId"`
	Taken     bool     `json:"taken"`
	Score     *float64 `json:"score,omitempty"`
	Message   string   `json:"message,omitempty"`
	Error     string   `json:"error,omitempty"`
	CheckedAt string   `json:"checkedAt"`
}

// 平台成绩页文案特征：最终得分、「已完成考试/已交卷」等参与提示。
var yhFinalScoreRe = regexp.MustCompile(`最终得分：[^\d]*([\d]+(?:\.[\d]+)?)[^分]*分`)
var yhExamTakenRe = regexp.MustCompile(`您已完成(?:该)?考试|考试已(?:完成|交卷)|已完成考试|已参加(?:该)?考试|已交卷`)

// examResult GET /api/exam.json —— 只读拉取考试结果页（不触发开始考试流程）。
func (s *yhSession) examResult(ctx context.Context, nodeID, examID string) (string, error) {
	c := s.creds()
	url := fmt.Sprintf("%s/api/exam.json?nodeId=%s&examId=%s&token=%s", c.baseURL, nodeID, examID, c.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	s.setHeaders(req)
	resp, err := s.client.Do(req)
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

type yhExamKey struct {
	ExamID string `json:"examId"`
	NodeID string `json:"nodeId"`
}

// RunExamResultsWithCreds 批量只读查询考试状态与得分（仅英华）。
// 单场失败不会中断整批，错误随该场结果返回。
func RunExamResultsWithCreds(
	ctx context.Context,
	sess core.Session,
	account, passwd string,
	exams []yhExamKey,
) ([]yhExamResult, error) {
	if len(exams) > 30 {
		return nil, fmt.Errorf("单次最多查询 30 场考试")
	}
	base := sess.Extra["url"]
	if base == "" {
		return nil, fmt.Errorf("会话缺少站点地址")
	}
	if account == "" || passwd == "" {
		return nil, fmt.Errorf("缺少英华登录凭据（账号/密码），无法查询考试结果")
	}
	sess2, err := getYhSession(base, account, passwd)
	if err != nil {
		return nil, fmt.Errorf("建立英华会话失败: %w", err)
	}
	out := make([]yhExamResult, 0, len(exams))
	for _, key := range exams {
		item := yhExamResult{
			ExamID:    key.ExamID,
			NodeID:    key.NodeID,
			CheckedAt: time.Now().Format(time.RFC3339),
		}
		body, err := sess2.examResult(ctx, key.NodeID, key.ExamID)
		if err != nil {
			item.Error = err.Error()
			out = append(out, item)
			continue
		}
		if checkRelogin(body) != nil {
			// 会话过期：原地重登一次再查
			if rerr := sess2.relogin(); rerr != nil {
				item.Error = fmt.Sprintf("登录超时且重登失败: %v", rerr)
				out = append(out, item)
				continue
			}
			body, err = sess2.examResult(ctx, key.NodeID, key.ExamID)
			if err != nil {
				item.Error = err.Error()
				out = append(out, item)
				continue
			}
		}
		if m := yhFinalScoreRe.FindStringSubmatch(body); len(m) > 1 {
			if score, perr := strconv.ParseFloat(m[1], 64); perr == nil {
				item.Taken = true
				item.Score = &score
				item.Message = "已参加考试"
				out = append(out, item)
				continue
			}
		}
		if yhExamTakenRe.MatchString(body) {
			item.Taken = true
			item.Message = "已参加考试，成绩未出"
			out = append(out, item)
			continue
		}
		// 平台 JSON 提示（如「考试时间还未开始」）直接透传，便于前端展示
		if msg, ok := gojsonq.New().JSONString(body).Find("msg").(string); ok && msg != "" {
			item.Message = msg
		} else {
			item.Message = "未查询到成绩，可能未参加或成绩尚未公布"
		}
		out = append(out, item)
	}
	return out, nil
}
