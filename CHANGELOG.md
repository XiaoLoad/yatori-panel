# Changelog

本项目的全部显著变更记录于此文件。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 网关二进制瘦身：需上游 ddddocr-go 重构 go:embed 结构（当前全平台运行库
  与三份重复模型约占 210MB，Windows 实际仅需约 56MB）
- 二期：完成通知、定时任务、统计图表、config 导入、代理池

## [v0.3.0] - 2026-10-31

服务器部署就绪版本（M4）。

### Added

- **server**：面板访问锁——scrypt 密码哈希 + HMAC 会话 Cookie（7 天）；
  登出/改密经会话纪元递增吊销全部旧 token；支持启用/修改/关闭
- **server**：前端构建产物同源托管，生产模式单端口（8080）
- **web**：登录页、路由守卫、401 统一拦截；设置页访问锁管理卡片
- **deploy**：start.bat 一键启动（自动补齐构建产物）；Docker Compose
  双服务编排（gateway 容器内 CGO 编译 / panel 用 node:24 + node:sqlite）

### Changed

- **gateway**：依赖锁定上游 core v1.9.1-0.20261029151038，移除本地 replace，
  构建不再依赖本地克隆

## [v0.2.0] - 2026-10-31

可视化面板首个完整版本（M3）。

### Added

- **web**：Vue 3.5 + TS strict + Tailwind v4 面板，六个页面——仪表盘、账号管理
  （动态登录表单，字段由网关 `/platforms` schema 驱动）、课程浏览（章节树）、
  任务控制台（三模式发起/停止/实时进度条/标红提醒）、实时日志（过滤/贴底）、
  全局设置（AI/题库/调度参数）
- **web**：全局单例 SSE 接入，五类事件类型安全分发；暗色模式一键切换
- **build**：pre-commit 类型检查覆盖 apps/web（vue-tsc）

## [v0.1.0-alpha.1] - 2026-10-31

首个内部里程碑：真实账号验证通过（登录/课程/章节树/学时提交链路），无 UI。

### Added

- **gateway**：yatori-go-core 的本地 HTTP 网关 sidecar——SDK 会话管理、课程/章节树/作业/考试接口、单次学时提交（tick）、AI 与外置题库配置透传、SSE 日志流（环形缓冲回放 + 实时推送）、平台元数据接口（能力位 + 登录字段 schema，驱动前端动态表单）
- **server**：面板业务后端——账号管理（密码 AES-GCM 加密存储）、JobManager（普通/暴力/去红三模式调度、5s tick 循环、标红检测、解锁时间跳过、断点续播）、SSE 事件总线（五类事件）、node:sqlite 持久化、全局设置
- **shared**：前后端共享类型与 zod 校验 schema

### Changed

- 依赖与运行时为适配本机环境做过三次替换：pnpm → bun（杀软锁目录）、tsx → Node 原生 TS（esbuild 被锁）、better-sqlite3 → node:sqlite（预编译下载受 TLS 证书链影响且无 node-gyp）

### Verified

- 英华真实账号：登录（验证码 OCR）、课程列表、章节树、学时提交链路；平台"时间锁/顺序锁"响应被跳过规则正确命中
