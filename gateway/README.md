# yatori-panel 网关（Go sidecar）

把 [yatori-go-core](https://github.com/yatori-dev/yatori-go-core) 的统一 SDK 以本地 HTTP 服务的形式暴露给面板业务后端（Node/TS）。
网关不含业务逻辑：只管理"每个上游账号一个 SDK 会话"，并做 REST ↔ `yatori.Client` 的映射。

## 构建与运行

```bash
# 依赖 go.mod 固定版本的 yatori-go-core；OCR（ddddocr-go → onnxruntime_go）依赖 CGO，
# 需要开启 CGO 并保证本机有 C 编译器（MinGW-w64 / GCC 均可）。
CGO_ENABLED=1 go build -ldflags "-s -w" -o bin/gateway.exe .

# 运行（本机回环）；运行时 OCR 模型由 ddddocr-go 内嵌并自动释放，无需手动放置 DLL
./bin/gateway.exe -addr 127.0.0.1:9801

# 容器健康检查可调用内置探针，无需镜像内安装 curl/wget
./bin/gateway.exe -health-check
```

只监听本机回环地址；Docker 镜像内部改为 `0.0.0.0:9801`，但不对外发布端口。

## 鉴权与调试

- `GATEWAY_TOKEN`：面板与网关共享密钥。设置后除 `/api/v1/health` 外所有接口都要求 `Authorization: Bearer <token>`；Docker Compose 会从同一份 `.env` 注入到两端。为空时保持旧行为，仅限本机回环调试。
- `GATEWAY_CORS_ORIGIN`：浏览器跨域直连调试时填写固定 Origin；留空不开放 CORS，不再使用 `*`。
- `GATEWAY_DEBUG_SESSION`：默认关闭，会话详情不再返回上游 cookie/token；仅显式设为 `true` 时返回原始快照。

## API 一览

统一响应包装：`{"ok": true, "data": ...}` 或 `{"ok": false, "error": "...", "logs": [...]}`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查 |
| GET | `/api/v1/platforms` | 平台元数据（能力位 + 登录字段 schema，驱动前端动态表单） |
| POST | `/api/v1/sessions` | 创建会话并登录。body：`{platform, username, password, url, school, cookie?, proxyURL?, ai?, questionBank?}`；失败时返回 `logs` 便于排查（含验证码 OCR 过程） |
| GET | `/api/v1/sessions` | 存活会话列表 |
| GET | `/api/v1/sessions/{id}` | 会话详情；默认隐藏 cookie/token 快照 |
| DELETE | `/api/v1/sessions/{id}` | 关闭会话 |
| GET | `/api/v1/sessions/{id}/courses` | 课程列表 |
| GET | `/api/v1/sessions/{id}/courses/{courseId}/tree` | 章节树（视频/作业/考试节点） |
| GET | `/api/v1/sessions/{id}/courses/{courseId}/works` | 作业列表 |
| GET | `/api/v1/sessions/{id}/courses/{courseId}/exams` | 考试列表 |
| POST | `/api/v1/sessions/{id}/study` | 单次学时提交（tick）。body：`{courseId, nodeId, action?, mode?, positionSeconds}`，action 默认 `progress`，mode 默认 `normal` |
| POST | `/api/v1/sessions/{id}/works/do` | 做作业。body：`{courseId, workId, source: "ai"\|"bank", submit}` |
| POST | `/api/v1/sessions/{id}/exams/do` | 考试。body 同上（examId） |
| GET | `/api/v1/sessions/{id}/logs` | SSE 日志流（先回放最近 1000 条，再实时推送；15s 心跳） |
| GET | `/api/v1/sessions/{id}/logs/recent` | 最近日志（JSON 数组） |

## 重要约定

1. **ID 直查**：`study` / `works/do` / `exams/do` 只需传 ID；适配器会回查内部缓存，但前提是**先调用过对应的列表/树接口**。
2. **tick 节奏归调用方**：`study` 是单次提交原语（参考 core 的设计注释），每 5 秒循环一次的调度在面板业务后端实现——这也是"普通/暴力/去红"三模式的实现位置。
3. **AI / 题库配置在会话级**：创建会话时通过 `ai` / `questionBank` 传入，`source` 参数选择答题来源。
4. **登录失败**返回 401 + `logs`（验证码 OCR、重定向等过程都在里面）。
