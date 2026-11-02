#!/usr/bin/env node
// 发版前校验：版本号格式、CHANGELOG 版本段存在且非空、tag 是否已合入 main。
//   node scripts/check-release.mjs v0.13.0 [--require-main] [--notes-file RELEASE_NOTES.md]
// 任何一项不通过即退出码 1，发版流水线随即中断（不再静默降级为"见提交历史"）。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = path.join(root, "CHANGELOG.md");
const VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

const args = process.argv.slice(2);
const notesIndex = args.indexOf("--notes-file");
const notesFile = notesIndex >= 0 ? args[notesIndex + 1] : null;
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a, i) => !a.startsWith("--") && !(notesIndex >= 0 && i === notesIndex + 1));
const rawVersion = positional[0] ?? process.env.GITHUB_REF_NAME;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

if (!rawVersion) fail("缺少版本号，用法：node scripts/check-release.mjs vX.Y.Z");
if (!VERSION_RE.test(rawVersion)) fail(`版本号不合法：${rawVersion}（要求 vX.Y.Z 或 vX.Y.Z-alpha.N）`);
const version = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;

const md = fs.readFileSync(changelogPath, "utf8");
const escaped = version.replace(/\./g, "\\.");
// 标题必须形如 "## [v0.13.0] - 2026-11-02"，且全文件仅一处
const headingRe = new RegExp(`^## \\[${escaped}\\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$`, "gm");
const matches = [...md.matchAll(headingRe)];
if (matches.length === 0) {
  fail(`CHANGELOG.md 缺少 "${version} - YYYY-MM-DD" 版本段，请先运行 bun run changelog:release ${version}`);
}
if (matches.length > 1) fail(`CHANGELOG.md 存在重复的 ${version} 段`);

const [, date] = matches[0];
if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) fail(`${version} 段的日期不合法：${date}`);

const start = matches[0].index + matches[0][0].length;
const rest = md.slice(start);
const end = rest.search(/^## \[/m);
const section = (end < 0 ? rest : rest.slice(0, end)).trim();
if (!section) fail(`${version} 段没有内容，请在发版前补齐变更条目`);
if (!/^### /m.test(section)) fail(`${version} 段没有任何分类小节（### Added / Fixed / Docs ...）`);
if (!/^- /m.test(section)) fail(`${version} 段没有任何条目`);

if (flags.has("--require-main")) {
  const tagSha = spawnSync("git", ["rev-parse", "--verify", `refs/tags/${version}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (tagSha.status !== 0) fail(`本地不存在 tag ${version}`);
  const mainSha = spawnSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], {
    cwd: root,
    encoding: "utf8",
  });
  if (mainSha.status !== 0) fail("未找到 origin/main，发版前请先 fetch main 分支");
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", tagSha.stdout.trim(), "origin/main"], {
    cwd: root,
  });
  if (ancestor.status !== 0) fail(`tag ${version} 不在 origin/main 的提交历史上，请先合入并推送 main`);
}

if (notesFile) {
  fs.writeFileSync(path.resolve(root, notesFile), `${section}\n`);
  console.log(`校验通过：${version}（${date}）；Release 说明已写入 ${notesFile}`);
} else {
  console.log(`校验通过：${version}（${date}）`);
}
