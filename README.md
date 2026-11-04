<div align="center">

# yatori-panel

**给网课学习，一个可视化的操控台。**

[yatori-go-console](https://github.com/yatori-dev/yatori-go-console) 系列的可视化操控面板：基于 [yatori-go-core](https://github.com/yatori-dev/yatori-go-core) 统一 SDK 构建，提供账号中心、观测台、单场作业/考试触发、定时调度与全链路日志，一期支持英华学堂与学习通，架构上保留任意平台的可插拔接入。

![Version](https://img.shields.io/badge/version-v0.13.0-2563EB?logo=semver&logoColor=white) ![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white) ![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.4-F472B6?logo=bun&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white) ![Go](https://img.shields.io/badge/Go-%E2%89%A51.27-00ADD8?logo=go&logoColor=white) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-06B6D4?logo=tailwindcss&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

[快速开始](#快速开始) · [核心特性](#核心特性) · [功能页面](#功能页面) · [架构与平台可插拔](#架构与平台可插拔) · [常见问题](#常见问题)

</div>

> [!WARNING]
> **本项目仅供学习使用，严禁贩卖。**
> 使用本工具产生的一切后果由使用者自行承担。

---

## 核心特性

* **账号中心** —— 账号列表与详情页：课程进度章节树（节点状态/考试徽标）、作业、考试、实时日志、任务记录五个分段；登录凭据 AES-GCM 加密存储，支持一键打开平台并复制登录信息。
* **观测台** —— 全站任务与多课程进度一屏总览：运行卡片、批量暂停/停止、节点级进度、运行中日志实时流。
* **单场作业/考试触发** —— 作业批量完成与提交模式选择；考试逐题作答、三态交卷（不交卷/智能/直接）；答题源可选 AI 或外置题库；英华作业/考试支持只读查分（不消耗做题次数）。
* **定时调度** —— 按窗口自动为多个账号发起任务，配合任务三模式（普通/暴力/去红）调度执行。
* **日志与台账** —— 全站日志页按级别/账号/任务/关键字分页检索，按时间段删除（保护近 7 天）；台账按天归档、可展开、服务端分页。
* **操作安全** —— 面板访问锁（可选密码）、关键操作二次确认、进行中按钮上锁防重复点击、全局加载条与切换动效。
* **平台可插拔** —— 新平台接入 = 上游 core 增加 driver → 网关自动暴露平台元数据 → 前端动态表单与调度自动可用，业务代码零改动。
* **多种部署** —— Windows 一键脚本 / Docker Compose / 手动构建，任选其一。

## 快速开始

### 环境要求

* Node.js ≥ 24（原生运行 TypeScript）
* bun ≥ 1.4（包管理）
* Go ≥ 1.27 与 GCC（仅网关构建需要；CGO 必须，OCR 依赖）

### Windows 一键启动

日常使用无需手动构建，双击即可：

```bat
start.bat    # 自动安装依赖、构建网关与前端（仅首次）、启动面板并打开浏览器
stop.bat     # 按命令行特征精确结束面板进程，不影响其他程序
```

启动后访问 `http://127.0.0.1:8080`（面板与网关均仅监听本机回环：面板 `127.0.0.1:8080`，网关 `127.0.0.1:9801`）。

### Docker 部署

```bash
docker compose up -d --build    # 一键启动（网关 + 面板）
docker compose logs -f          # 查看日志
docker compose down             # 停止服务
```

启动后访问 `http://localhost:8080`；网关仅在容器网络内监听，不对外发布端口。运行时数据存于 `panel-data` 卷（容器内 `/app/data`）。

### 开发模式

```bash
bun install                              # 安装依赖

bun run gateway:build && bun run gateway:start   # 构建并启动网关

bun run dev:server                       # 面板后端（node --watch）
bun run dev:web                          # 前端热更新
```

## 目录结构

```text
yatori-panel/
├── package.json            # 工作区脚本（dev / typecheck / changelog / gateway）
├── cliff.toml              # git-cliff 更新日志生成配置
├── CHANGELOG.md            # 版本更新日志（git-cliff 生成 + 发版时人工润色）
├── compose.yaml            # Docker Compose（gateway + panel 双容器）
├── panel.Dockerfile        # 面板镜像（node:24 原生运行 TS）
├── start.bat / stop.bat    # Windows 一键启动 / 停止
├── scripts/                # 辅助脚本
│   ├── changelog.mjs       #   CHANGELOG 生成与版本段发布
│   ├── check-release.mjs   #   发版前置校验（版本段 / tag 合入 main）
│   └── smoke.mjs           #   发版产物冒烟
├── apps/
│   ├── web/                # Vue 3 前端
│   │   └── src/
│   │       ├── views/      #   页面（观测台、账号、台账、日志等）
│   │       ├── components/ #   业务组件与 UI 组件
│   │       ├── composables/#   组合式函数（考试/作业状态轮询）
│   │       ├── stores/     #   Pinia 状态（SSE 事件总线、认证）
│   │       └── api/        #   axios 客户端与资源封装
│   └── server/             # 业务后端（Node 24 原生 TypeScript）
│       └── src/
│           ├── routes.ts   #   REST API 路由
│           ├── services/   #   JobManager 任务调度
│           └── db/         #   SQLite 持久化（node:sqlite）
├── packages/shared/        # 前后端共享类型与 zod 校验 schema
├── gateway/                # Go 网关（core.Client → REST 薄包装）
│   └── README.md           #   网关设计说明与平台接入指南
└── data/                   # 运行时数据（自动生成，不入库 Git）
```

## 功能页面

| 路径 | 页面 | 功能 |
|------|------|------|
| `/` | 观测台 | 全站任务总览、多课程进度、批量暂停/停止、运行中日志 |
| `/accounts` | 账号列表 | 账号增删改、批量导入（YAML）、登录检测、发起任务 |
| `/accounts/:uid` | 账号详情 | 课程进度/作业/考试/实时日志/任务记录五分段 |
| `/history` | 台账 | 任务记录按天归档、筛选与分页、产出统计 |
| `/logs` | 日志 | 全站日志检索（级别/账号/任务/关键字）、按时间段删除 |
| `/schedules` | 定时任务 | 调度窗口与账号组配置、启停切换 |
| `/settings` | 设置 | 答题源（AI/题库）配置、连通性预检、访问锁 |
| `/login` | 登录 | 面板访问锁解锁页（设置了密码时） |

## 架构与平台可插拔

```
Vue 3 面板 (apps/web)
   │ REST + SSE
Node/TS 业务后端 (apps/server)  ← 你日常维护的层
   │ HTTP sidecar
Go 网关 (gateway)              ← core.Client → REST 的薄包装
   │ import
yatori-go-core（上游逆向资产）
```

* **gateway**：无状态 sidecar，管理"每账号一个 SDK 会话"——会话生命周期、课程/章节树、单次学时 tick、AI/题库配置透传、SSE 日志流。OCR（验证码识别）运行库与模型由 ddddocr-go 内嵌，无需额外分发。
* **apps/server**：业务大脑——账号管理（AES-GCM 密码加密）、JobManager（普通/暴力/去红三模式调度）、SSE 事件总线（进度/日志/状态）、SQLite 持久化（node:sqlite）。
* **packages/shared**：前后端共享类型与 zod 校验 schema。

新平台接入 = 上游 core 增加 driver → 网关 `/api/v1/platforms` 自动多出该平台的元数据（能力位 + 登录字段 schema）→ 前端动态表单与调度自动可用，业务代码零改动，详见 [gateway/README.md](gateway/README.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Vue Router + Pinia + TanStack Query + TailwindCSS 4 + ECharts + GSAP |
| 后端 | Node.js 24（原生运行 TS）+ node:sqlite + SSE |
| 网关 | Go + CGO + ddddocr-go（OCR） |
| 工程 | Bun monorepo + commitlint + simple-git-hooks + git-cliff |
| 部署 | Docker Compose / Windows 脚本 / 手动构建 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PANEL_HOST` | `127.0.0.1` | 面板监听地址（Docker 中为 `0.0.0.0`） |
| `PANEL_PORT` | `8080` | 面板监听端口 |
| `GATEWAY_URL` | `http://127.0.0.1:9801` | 网关地址（Docker 中为 `http://gateway:9801`） |
| `PANEL_DATA_DIR` | 项目根目录 `data/` | 数据存储目录（Docker 中为 `/app/data`） |
| `WEB_DIST` | `apps/web/dist` | 前端产物目录（后端静态托管） |

## 常见问题

**支持哪些平台？**目前支持英华学堂与学习通。架构上平台可插拔，接入新平台只需上游 core 提供对应 driver，面板侧零代码改动。

**任务日志里出现"服务重启，任务被中断"？**服务进程重启时，启动例程会把数据库中遗留的 running 状态任务标记为中断（详见文首[提示](#yatori-panel)）——这是保护机制而非程序错误，重新发起任务即可。

**网关显示离线？**面板后端依赖网关 sidecar。本地部署先执行 `bun run gateway:build && bun run gateway:start`；修改过 Go 代码后必须重新构建并重启网关。

**登录英华时提示验证码？**网关内嵌 ddddocr OCR 自动识别，无需人工干预；若识别失败可重试或检测登录。

**数据存在哪里？**统一在 `PANEL_DATA_DIR`（默认项目根目录 `data/`，Docker 中为 `panel-data` 卷），备份该目录即可。

**端口被占用？**通过 `PANEL_PORT` 环境变量更换面板端口；网关端口由启动参数 `-addr` 指定。

## 参与开发

```bash
bun install                # 安装依赖
bun run typecheck:all      # 三包类型检查（pre-commit 钩子同款）
bun run dev:server         # 后端开发模式
bun run dev:web            # 前端热更新
```

提交信息遵循[约定式提交](https://www.conventionalcommits.org/zh-hans/)（`feat` / `fix` / `docs` / `refactor` / `chore` 等），由 commitlint 强制校验；`main` 分支每个提交必须通过三包类型检查。

发版流程：`bun run changelog:release vX.Y.Z` 生成版本段并人工润色 → 提交 → 打 tag 推送，流水线自动校验、构建与发布（详见 [CHANGELOG.md](CHANGELOG.md) 头部说明）。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)（基于提交记录由 git-cliff 自动生成）。
