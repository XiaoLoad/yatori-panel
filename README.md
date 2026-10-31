# yatori-panel

[yatori-go-console](https://github.com/yatori-dev/yatori-go-console) 系列的可视化操控面板。基于 [yatori-go-core](https://github.com/yatori-dev/yatori-go-core) 的统一 SDK 构建，一期支持英华学堂，架构上保留任意平台的可插拔接入。

> 仅供学习使用，严禁贩卖。使用本工具产生的一切后果由使用者自行承担。

## 架构

```
Vue 3 面板 (apps/web)
   │ REST + SSE
Node/TS 业务后端 (apps/server)  ← 你日常维护的层
   │ HTTP sidecar
Go 网关 (gateway)              ← core.Client → REST 的薄包装
   │ import
yatori-go-core（上游逆向资产）
```

- **gateway**：无状态 sidecar，管理"每账号一个 SDK 会话"，`/api/v1/sessions`、课程/章节树、单次学时 tick、AI/题库配置透传、SSE 日志流。OCR（验证码识别）运行库与模型由 ddddocr-go 内嵌，无需额外分发。
- **apps/server**：业务大脑——账号管理（密码 AES-GCM 加密存储）、JobManager（普通/暴力/去红三模式调度）、SSE 事件总线（进度/日志/状态）、SQLite 持久化（node:sqlite）。
- **packages/shared**：前后端共享类型与 zod 校验 schema。

## 平台可插拔

新平台接入 = 上游 core 增加 driver → 网关 `/api/v1/platforms` 自动多出该平台的元数据（能力位 + 登录字段 schema）→ 前端动态表单与调度自动可用，业务代码零改动。详见 `gateway/README.md`。

## 开发环境

| 组件 | 要求 |
|---|---|
| Go | ≥1.27（仅网关构建需要；CGO 必须，OCR 依赖） |
| Node | ≥24（原生运行 TypeScript） |
| bun | ≥1.4（包管理） |

```bash
bun install                          # 安装依赖
# 网关
bun run gateway:build && bun run gateway:start
# 面板后端（开发模式，node --watch）
cd apps/server && bun run dev
```

Windows 日常使用：双击 `start.bat` 启动，`stop.bat` 停止
（按命令行特征精确结束面板的 node 进程，不影响其他程序）。

默认端口：面板 `127.0.0.1:8080`，网关 `127.0.0.1:9801`（仅本机回环）。

## 版本

见 [CHANGELOG.md](./CHANGELOG.md)。遵循 Conventional Commits；main 分支每个提交必须通过双包类型检查。
