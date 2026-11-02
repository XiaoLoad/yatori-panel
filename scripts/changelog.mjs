#!/usr/bin/env node
// CHANGELOG 维护脚本：用 git-cliff 从提交生成条目，只改 [Unreleased] 段与版本段，
// 已发布的版本段（含人工润色的背景说明）原样保留。
//   node scripts/changelog.mjs update            重新生成 [Unreleased]（保留"计划中"）
//   node scripts/changelog.mjs release vX.Y.Z    把未发布提交生成新版本段，并补空 [Unreleased]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = path.join(root, "CHANGELOG.md");
const cliffConfig = path.join(root, "cliff.toml");
const cliffCli = fileURLToPath(import.meta.resolve("git-cliff/cli"));
const VERSION_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function runCliff(args) {
  const res = spawnSync(process.execPath, [cliffCli, "--config", cliffConfig, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    fail(`git-cliff 执行失败\n${res.stderr.trim()}`);
  }
  return res.stdout;
}

/** 把 CHANGELOG 拆成"文件头 + 各版本段" */
function splitSections(text) {
  const start = text.search(/^## \[/m);
  if (start < 0) return { header: text, sections: [] };
  const blocks = text.slice(start).split(/\n(?=## \[)/);
  return { header: text.slice(0, start), sections: blocks.map((s) => s.trimEnd()) };
}

/** 去掉 git-cliff 输出的文件头与标题行，只留条目正文 */
function bodyOf(output) {
  const lines = output.split("\n");
  const i = lines.findIndex((l) => l.startsWith("## ["));
  return (i < 0 ? "" : lines.slice(i + 1).join("\n")).trim();
}

function headingOf(output) {
  return output.split("\n").find((l) => l.startsWith("## [")) ?? "";
}

/** 从 [Unreleased] 段里取出"计划中"小节，发版后原样带过去 */
function extractPlan(block) {
  const lines = block.split("\n");
  const i = lines.findIndex((l) => l.trim() === "### 计划中");
  if (i < 0) return "";
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^### |^## /.test(lines[j])) break;
    out.push(lines[j]);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n").trim();
}

function buildUnreleased(plan, body) {
  const parts = ["## [Unreleased]"];
  if (body) parts.push(body);
  if (plan) parts.push(plan);
  return parts.join("\n\n");
}

function compose(header, sections) {
  return `${header.trimEnd()}\n\n${sections.join("\n\n")}\n`;
}

function main() {
  const mode = process.argv[2];
  const versionArg = process.argv[3];
  if (mode !== "update" && mode !== "release") {
    fail("用法：node scripts/changelog.mjs update | release vX.Y.Z");
  }

  const raw = fs.readFileSync(changelogPath, "utf8");
  const { header, sections } = splitSections(raw);
  const unreleasedIndex = sections.findIndex((s) => s.startsWith("## [Unreleased]"));
  const plan = unreleasedIndex >= 0 ? extractPlan(sections[unreleasedIndex]) : "";
  const released = sections.filter((_, i) => i !== unreleasedIndex);

  if (mode === "update") {
    const body = bodyOf(runCliff(["--unreleased"]));
    fs.writeFileSync(changelogPath, compose(header, [buildUnreleased(plan, body), ...released]));
    console.log(
      body
        ? "已重新生成 [Unreleased] 段（条目取自上一个 tag 以来的提交）"
        : "自上一个 tag 以来无可发布的提交，[Unreleased] 段仅保留计划项",
    );
    return;
  }

  if (!versionArg || !VERSION_RE.test(versionArg)) {
    fail("release 需要合法版本号，如 v0.13.0 或 v0.13.0-alpha.1");
  }
  const version = versionArg.startsWith("v") ? versionArg : `v${versionArg}`;
  if (released.some((s) => s.startsWith(`## [${version}]`))) {
    fail(`CHANGELOG 已存在 ${version} 段，若需重写请先手工删除该段`);
  }

  const output = runCliff(["--unreleased", "--tag", version]);
  const heading = headingOf(output);
  const body = bodyOf(output);
  if (!heading || !body) {
    fail("自上一个 tag 以来没有可发布的提交（或提交全部被 cliff 过滤），请检查提交信息");
  }

  fs.writeFileSync(
    changelogPath,
    compose(header, [`${heading}\n\n${body}`, buildUnreleased(plan, ""), ...released]),
  );
  console.log(`已生成 ${version} 段（标题日期取自最后一个提交）。请人工润色后提交：docs: 发布 ${version} 变更日志`);
}

main();
