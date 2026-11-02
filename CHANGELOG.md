# Changelog

本项目的全部显著变更记录于此文件。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **shared/server/web**：交卷策略三态化（对齐 console 的 ExamAutoSubmit 三档）——
  不交卷（仅保存）/ 智能交卷（两段式：先全保存，检测逐题留空，全部作答才交卷，
  耗时约翻倍）/ 直接交卷；原「完成后自动提交」开关退役，定时任务与单场考试
  触发同步支持三态；旧 auto_submit 数据自动迁移
- **server**：单场考试后台化——触发即返回，答题过程（会话就绪/全量作答/
  留空检测/交卷/结果）经 SSE 实时推送；账号内同场考试防重入，
  运行状态接口供页面刷新后恢复"答题中"显示
- **web**：考试区块实时过程面板——逐条展示单场考试里程碑日志
  （warn/error 分色），答题中按钮转圈禁用，结果 toast 同步三态；
  「实时日志」页可看全量输出
- **web**：课程浏览新增考试区块——考试名/题量/状态展示、答题源与
  交卷策略选择、单场触发；网关离线时禁用
- **web**：设置页字段宽度统一（URL 类长字段全宽）；题库地址/密钥
  placeholder 明确"密钥随 URL 参数携带，密钥项留空即可"

### Fixed

- **web**：页面入场动画与快速路由切换竞态——动画中途切页时 Vue 卸载节点
  触发 `parentNode is null` 报错；改为卸载前终止补间、清理内联样式，
  元素集合 nextTick 快照（gsap.context 托管）

### Changed

- **server**：任务发起与单场考试触发新增答题配置前置校验——AI/题库
  未配置直接 400 拒绝并给出指引，不再等待注定失败的探针请求超时
- **build**：GitHub Actions CI——push/PR 到 main 时自动跑三包类型检查
  与网关 CGO 编译（本地 pre-commit 的服务端兜底）
- **build**：GitHub Actions 发版自动化——推送版本 tag 自动构建
  web 产物 + 网关 Linux 二进制，从 CHANGELOG 提取版本段创建 Release
- **server**：网关状态机——后台 10s 心跳探测（区分未启动/假死/异常三类故障），
  up/down 变化经 SSE `gateway.status` 事件实时广播
- **server**：`GET /health` 返回网关故障细节（detail）；新增
  `POST /health/recheck` 供前端立即重检
- **web**：网关徽章升级为可点击诊断面板——故障原因、修复指引
  （start.bat / gateway:build / docker compose）、重新检测按钮；
  状态改由 SSE 驱动（网关恢复秒级变绿，不再依赖 10s 轮询）
- **web**：网关离线时统一体验——发起任务/登录检测/添加账号按钮禁用
  并提示，API 错误 toast 指引到右上角徽章诊断

### 计划中

- 上游瘦身 PR 落地后，重新锁定依赖（docs/upstream-slim-pr.md 已备实验数据）

## [v0.11.0] - 2026-11-02

二期功能集（C6/C7/E3/A5/A4）。

### Added

- **通知**：任务终态 WebAudio 提示音 + 邮箱 SMTP 完成通知（设置页
  新增邮箱卡片，手动停止不打扰）
- **定时任务**：cron 周期自动刷课（调度器重启恢复、账号忙跳过）；
  任务控制台新增定时区块（预设 + 自定义 cron）
- **统计**：GET /stats/daily 日聚合（补零对齐）；仪表盘近 14 天
  柱线混合图（完成视频 + 任务数，暗色自适应）
- **导入**：config.yaml 批量导入账号（console 格式 + 平台别名归一，
  文件选择或粘贴）
- **代理**：账号级代理地址字段（透传 core Options.ProxyURL）

### Docs

- docs/upstream-slim-pr.md：网关 226MB 死重分解与上游瘦身提案
  （实验实测移除腾讯求解器 embed 后 87.2MB）

## [v0.10.0] - 2026-11-01

### Added

- **web**：全局设置重构——草稿暂存/脏数据对比/变更明细
  （原值→新值，密钥脱敏）/一键保存与放弃修改
- **web**：AI 与题库「测试连接」预检按钮

### Fixed

- **web**：设置开关无法启用——查询 refetch 覆盖草稿
  + reka-ui v2 Switch 事件名不匹配，两个根因都修复

## [v0.9.0] - 2026-11-01

### Added

- **gateway**：登录异步化——会话状态机（logging_in/online/error），
  登录过程经日志流实时可见；同账号失败会话自动清理
- **server**：会话认领——面板重启后优先认领网关现存在线会话，
  避免重复登录（实测重启后首拉 3.1s，无重登）
- **web**：账号卡片「登录中」徽章；课程列表 60s 缓存

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

## [v0.7.1] - 2026-11-01

### Fixed

- **server**：进度真实性校验——只有平台返回「提交学时成功」才计进度，
  时间锁/顺序锁课程诚实跳过（此前被锁课程会假刷：本地标完成、
  平台无记录）
- **server**：启动时清理已删除账号遗留的进度快照
- **shared**：账号/任务校验消息中文化补全

## [v0.7.0] - 2026-11-01

### Changed

- **web**：交互重构为「账号为中心」——账号卡片一键开始/停止刷课
  （智能默认：全部未完成 + 普通模式 + 不答题），高级选项折叠
- **web**：任务控制台退位为监控 + 历史；课程浏览支持单课快捷启动

## [v0.6.3] - 2026-11-01

### Fixed

- **web**：添加账号空表单提交不再报英文 zod 错误——中文逐字段
  校验（红框+提示）、回车提交、DialogFooter 关闭误触发修复

## [v0.6.2] - 2026-11-01

### Fixed

- **web**：修复路由切换元素跳动

## [v0.6.1] - 2026-11-01

### Added

- **gateway**：会话级在线心跳（每 5 分钟，对齐 console keepAliveLogin），
  随会话生命周期启停
- **server**：任务运行器检测登录超时后自动重建会话并断点续刷，
  单任务上限 5 次；过程进实时日志

## [v0.6.0] - 2026-11-01

### Added

- **web**：仪表盘可视化重构——GSAP 进度环/数字滚动/入场编排，
  ECharts 各课程进度条形图，暗色为默认主题

## [v0.5.0] - 2026-10-31

### Added

- **web**：对齐 shadcn-admin 的 UI 重构与边界值治理

## [v0.4.0] - 2026-10-31

### Added

- **gateway**：`GET /sessions/:id/profile` 用户信息接口（英华：登录后首页
  渲染字段提取姓名）
- **server**：添加/检测账号时备注为空则自动填入平台真实姓名

## [v0.3.3] - 2026-10-31

### Fixed

- **server**：任务全流程里程碑日志，手动停止不再计为错误

## [v0.3.2] - 2026-10-31

### Added

- **server**：逐次学时提交以 DEBUG 级别进实时日志，不落库

## [v0.3.1] - 2026-10-31

### Fixed

- **server**：访问锁关闭时放行全部 API

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
