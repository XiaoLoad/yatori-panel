# 开发规范

本项目（yatori-panel）面向后续开发者整理的开发规范。架构与快速上手见 [README.md](../README.md)，本文只讲"怎么写、怎么提、怎么发"。

## 目录

1. [分支模型](#分支模型)
2. [提交规范（Conventional Commits）](#提交规范conventional-commits)
3. [质量门禁](#质量门禁)
4. [版本管理与发版规范](#版本管理与发版规范)
5. [CHANGELOG 维护](#changelog-维护)
6. [代码约定](#代码约定)
7. [依赖管理](#依赖管理)

---

## 分支模型

- **主分支**：`main`，始终可用、每个提交必须通过类型检查。
- **分级策略**（单人本地开发、暂无远端与 PR 审查时的折中）：
  - **直接提交 main**：单点修复、文档、配置、单文件级改动；提交前本地门禁必须通过。
  - **走短生命周期分支**：满足任一条件时使用 `feat/<主题>` 或 `fix/<主题>`：
    - 跨多个包（gateway / server / web / shared）
    - 涉及数据库 schema 或数据迁移
    - 涉及接口契约变更
    - 大范围 UI 重构，或需要整体回退的改动
  - 分支完成后以显式 merge 提交合入 main（保留分支上下文）：
    ```
    chore: 合并（feat/xxx）
    ```
- **命名规则**：
  - 功能：`feat/<主题>`，如 `feat/phase2`、`feat/session-adoption`
  - 修复：`fix/<主题>`，如 `fix/honest-progress`
  - 里程碑级（罕见，影响多个模块）：`feature/m<N>-<主题>`，如 `feature/m3-web`
- 分支应小而聚焦：一个分支对应一个 CHANGELOG 条目粒度的变更。跨多模块的大功能拆多个分支分批合入（参考 `feat/phase2` 的做法：多个 feat 提交后一次合并）。
- **升级条件**：配置远端仓库、启用 PR 与 CI 必需检查后，改回“所有改动必须走分支 + PR”，不再直接提交 main。

## 提交规范（Conventional Commits）

格式：`type[(scope)]: 中文 subject`

### type

`feat` / `fix` / `docs` / `chore` / `refactor` / `perf` / `test`

### scope（白名单枚举，仓库级提交可省略）

| scope | 范围 |
|---|---|
| `gateway` | Go 网关（gateway/） |
| `server` | 业务后端（apps/server/） |
| `web` | 前端面板（apps/web/） |
| `shared` | 共享类型与 schema（packages/shared/） |
| `deploy` | 部署相关（Dockerfile、compose、start/stop.bat） |
| `docs` | 文档 |

### 规则

- **subject 用中文**，简洁描述"做了什么"；句号规则已关闭。
- commit-msg 由 commitlint 强制校验（配置见 [commitlint.config.mjs](../commitlint.config.mjs)），不合规直接拒绝。
- 合并提交用 `chore: 合并（<分支名>）` 或 `chore: 合并<功能名>`。
- 发版提交固定为 `docs: 发布 vX.Y.Z 变更日志`。

### 示例

```
feat: 账号级代理地址字段（透传 core Options.ProxyURL）
fix(web): 全局设置重构——草稿暂存/脏数据对比/一键保存，修复开关无法启用
docs: 发布 v0.11.0 变更日志
chore: 合并（fix/settings-dirty-tracking）
```

## 质量门禁

由 `simple-git-hooks` 强制（见根 [package.json](../package.json)）：

- **pre-commit**：`bun run typecheck:all` —— 依次对 `packages/shared`、`apps/server`（tsc）、`apps/web`（vue-tsc）做类型检查。类型不过，提交不进 main。
- **commit-msg**：commitlint 校验。
- CI 侧另有一道 commitlint 任务做兜底（hooks 可被 `--no-verify` 绕过，且未装 hooks 的贡献者不受本地约束）。
- 新增包若纳入类型检查范围，需同步更新根 `typecheck:all` 脚本。

克隆后激活 hooks：

```bash
bun install   # trustedDependencies 含 simple-git-hooks，安装时自动生效
```

## 版本管理与发版规范

- **版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)**，当前处于 0.x 阶段：
  - **minor**（0.X.0）：功能集发布（一批 feat 合入）
  - **patch**（0.X.Y）：纯修复
  - 预发布：`-alpha.N` 后缀（如首个里程碑 `v0.1.0-alpha.1`）
- **每个发布版本打 git tag**（`vX.Y.Z`），tag 与 CHANGELOG 条目一一对应。
- **发版流程**：
  1. 功能分支全部合入 main，通过类型检查
  2. 生成版本段：`bun run changelog:release vX.Y.Z`（条目取自上个 tag 以来的提交）
  3. **人工润色该版本段**（补背景/实测数据/影响范围），提交 `docs: 发布 vX.Y.Z 变更日志`
  4. 本地自检：`bun run release:check vX.Y.Z`（版本段存在、日期合法、条目非空）
  5. `git tag vX.Y.Z && git push origin main --tags`
  6. GitHub Actions 重新校验后构建产物并创建 Release（见 [CI/CD](#cicd)）
- 发版流水线会硬性校验"版本段存在且非空 + tag 已合入 main"，不满足直接失败，不再降级为"见提交历史"。
- 未发布内容由 `bun run changelog:update` 从提交自动生成到 `[Unreleased]`；其中 `### 计划中` 为人工维护项，发版后自动带入新的 `[Unreleased]`。

## CHANGELOG 维护

- 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)（中文版），位于根 [CHANGELOG.md](../CHANGELOG.md)。
- **条目由 [git-cliff](https://git-cliff.org/) 从 Conventional Commits 生成**（配置见 [cliff.toml](../cliff.toml)），不再手工逐条抄写：
  - `bun run changelog:preview`：预览自上个 tag 以来的条目
  - `bun run changelog:update`：重新生成 `[Unreleased]` 段
  - `bun run changelog:release vX.Y.Z`：发版时生成版本段
- **自动生成只是初稿**：发版时必须人工润色该版本段（写清背景与实测数据，参考 v0.1.0 的 "Changed" 与 "Verified"），提交信息本身的表述由提交规范把关。
- 已发布的版本段不会被覆盖——脚本只改 `[Unreleased]` 与新增版本段。
- 条目顺序固定为 `Added` / `Changed` / `Fixed` / `Docs` / `Verified`；scope 前缀取自提交的 `(scope)`（`**web**：...`）。
- 提交信息即条目内容：写提交时按"用户能看懂的功能描述"写 subject，不要写"更新代码"这类空话。

## 代码约定

- **TypeScript**：strict 模式，前后端共享类型与校验统一放 `packages/shared`（zod schema 为单一事实来源）。
- **校验与错误信息**：面向用户的提示一律中文（含 zod 自定义 message，参考 v0.6.3 教训：不裸露英文 zod 错误）。
- **进度/状态真实性**：只有平台确认成功才计进度，不得本地"乐观标记"（参考 v0.7.1 "诚实进度"修复）。
- **Web 组件**：基于 shadcn-admin 风格，交互变更需检查暗色主题下的表现（暗色为默认主题）。
- **注释与文档语言**：中文为主，与提交规范一致。

## 依赖管理

- 包管理统一用 **bun**（workspace），Go 依赖经 go.mod。
- **上游 core 锁定具体 commit**，移除本地 replace，构建不依赖本地克隆；升级上游需在 CHANGELOG 记录。
- 运行时/依赖如有环境适配替换，必须在 CHANGELOG 中记录原因（参考 v0.1.0 的三次替换记录），避免后人重复踩坑。

## CI/CD

GitHub Actions 双工作流，配置位于 `.github/workflows/`（属版本库内容，**不**在忽略范围）：

### CI（[ci.yml](../.github/workflows/ci.yml)）

- **触发**：push / PR 到 main
- **四个并行任务**：
  - 类型检查：三包 tsc / vue-tsc（复用根 `typecheck:all`）
  - 网关编译：Go + CGO
  - 提交信息校验：commitlint 校验本次推送 / PR 区间内的全部提交（Merge 提交按 commitlint 默认规则忽略）
  - 构建冒烟：构建前端产物后真实启动面板后端，校验 `/api/v1/health`（Node 版本对齐运行镜像 24）
- 与本地 pre-commit / commit-msg 门禁互为冗余——hooks 可被 `--no-verify` 绕过，CI 是最终防线

### Release（[release.yml](../.github/workflows/release.yml)）

- **触发**：推送 `v*.*.*`（含预发布 `-alpha.N`）tag
- **内容**：类型检查 → 发版校验（`scripts/check-release.mjs`：版本段存在且非空、日期合法、
  tag 已合入 main，任一不满足直接失败）→ 前端构建 → 产物冒烟 → 打包 web 产物 + server/shared
  源码 → 校验压缩包内容 → 网关 Linux amd64 编译（CGO，Windows 走 start.bat 或 Docker）→
  自动创建 GitHub Release
- **Release 说明**取自 CHANGELOG 对应版本段，无需手工维护
- **发版时无需手动构建/上传任何产物**，tag 即发版
