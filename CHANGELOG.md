# Changelog

本项目的全部显著变更记录于此文件。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- M3：Vue 3 + shadcn-vue 可视化面板（仪表盘/账号管理/课程树/任务控制台/日志/设置）
- M4：面板访问锁、Docker Compose 部署、Windows 一键启动、二进制体积优化

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
