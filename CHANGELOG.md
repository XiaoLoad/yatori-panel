# Changelog

本项目的全部显著变更记录于此文件。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v0.4.0] - 2026-10-31

### Added

- **gateway**：`GET /sessions/:id/profile` 用户信息接口（英华：登录后首页
  渲染字段提取姓名）
- **server**：添加/检测账号时备注为空则自动填入平台真实姓名

## [v0.6.0] - 2026-11-01

### Added

- **web**：仪表盘可视化重构——GSAP 进度环/数字滚动/入场编排，
  ECharts 各课程进度条形图，暗色为默认主题

## [v0.6.1] - 2026-11-01

### Added

- **gateway**：会话级在线心跳（每 5 分钟，对齐 console keepAliveLogin），
  随会话生命周期启停
- **server**：任务运行器检测登录超时后自动重建会话并断点续刷，
  单任务上限 5 次；过程进实时日志

## [v0.6.3] - 2026-11-01

### Fixed

- **web**：添加账号空表单提交不再报英文 zod 错误——中文逐字段
  校验（红框+提示）、回车提交、DialogFooter 关闭误触发修复

## [v0.7.0] - 2026-11-01

### Changed

- **web**：交互重构为「账号为中心」——账号卡片一键开始/停止刷课
  （智能默认：全部未完成 + 普通模式 + 不答题），高级选项折叠
- **web**：任务控制台退位为监控 + 历史；课程浏览支持单课快捷启动

## [v0.7.1] - 2026-11-01

### Fixed

- **server**：进度真实性校验——只有平台返回「提交学时成功」才计进度，
  时间锁/顺序锁课程诚实跳过（此前被锁课程会假刷：本地标完成、
  平台无记录）
- **server**：启动时清理已删除账号遗留的进度快照
- **shared**：账号/任务校验消息中文化补全

## [v0.8.0] - 2026-11-01

### Added

- **gateway**：`POST /api/v1/preflight` AI/题库可用性预检
  （对齐 console 的 AICheck / CheckApiQueRequest 前置检查）
- **server**：发起任务时答题来源预检门禁，不可用直接拒绝启动
- **server**：作业/考试结果三态化（得分/未确认/未提交），
  得分进任务摘要

### Fixed

- **web**：交卷失败不再显示「考试完成」（与视频假进度同类
  问题的作业/考试版修复）

## [v0.9.0] - 2026-11-01

### Added

- **gateway**：登录异步化——会话状态机（logging_in/online/error），
  登录过程经日志流实时可见；同账号失败会话自动清理
- **server**：会话认领——面板重启后优先认领网关现存在线会话，
  避免重复登录（实测重启后首拉 3.1s，无重登）
- **web**：账号卡片「登录中」徽章；课程列表 60s 缓存

## [v0.10.0] - 2026-11-01

### Added

- **web**：全局设置重构——草稿暂存/脏数据对比/变更明细
  （原值→新值，密钥脱敏）/一键保存与放弃修改
- **web**：AI 与题库「测试连接」预检按钮

### Fixed

- **web**：设置开关无法启用——查询 refetch 覆盖草稿
  + reka-ui v2 Switch 事件名不匹配，两个根因都修复

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
