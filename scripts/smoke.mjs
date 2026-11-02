#!/usr/bin/env node
// 产物冒烟：确认前端构建产物存在，并真实启动面板后端验证 /api/v1/health。
// 用于 CI 与发版流水线——打包错漏（产物缺失、启动即崩）在流水线内暴露，而不是等用户反馈。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDist = path.join(root, "apps", "web", "dist");
const indexHtml = path.join(webDist, "index.html");
const PORT = 18080;
const TIMEOUT_MS = 30_000;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexHtml)) {
  fail(`前端产物缺失：${indexHtml}（先运行 apps/web 的 build）`);
}
const assets = fs.readdirSync(path.join(webDist, "assets"), { withFileTypes: true }).filter((d) => d.isFile());
if (assets.length === 0) fail("前端产物 assets/ 为空");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yatori-smoke-"));
const child = spawn(process.execPath, [path.join(root, "apps", "server", "src", "index.ts")], {
  cwd: root,
  env: {
    ...process.env,
    PANEL_HOST: "127.0.0.1",
    PANEL_PORT: String(PORT),
    PANEL_DATA_DIR: dataDir,
    WEB_DIST: webDist,
    // 指向不存在的网关：健康接口仍应返回 ok，仅 gateway 状态为 down
    GATEWAY_URL: "http://127.0.0.1:1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const logs = [];
let shuttingDown = false;
child.stdout.on("data", (b) => logs.push(b.toString()));
child.stderr.on("data", (b) => logs.push(b.toString()));
child.on("exit", (code) => {
  if (!shuttingDown && code !== 0) fail(`面板后端启动失败（退出码 ${code}）：\n${logs.join("")}`);
});

async function waitHealth() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`);
      const json = await res.json();
      if (res.ok && json.ok === true) return json;
    } catch {
      // 端口还没起来，继续等待
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`面板后端在 ${TIMEOUT_MS / 1000}s 内未通过健康检查：\n${logs.join("")}`);
}

async function stopChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    // 兜底：Windows 上进程可能不响应 SIGTERM
    setTimeout(() => child.kill("SIGKILL"), 3000).unref();
  });
}

try {
  const health = await waitHealth();
  console.log(`冒烟通过：/api/v1/health = ${JSON.stringify(health.data)}`);
} finally {
  shuttingDown = true;
  await stopChild();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 临时目录残留不影响冒烟结论
  }
}
