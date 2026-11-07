import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bus } from "./bus.ts";
import { env, repoRoot } from "./env.ts";
import { refreshGatewayStatus, snapshot } from "./gateway-status.ts";

/**
 * 网关假死自愈：心跳探测判定网关离线（进程未启动/假死）时，
 * 面板侧自动拉起网关二进制（sidecar 模式），无需人工重启。
 *
 * 设计约束：
 *  - 仅本地 sidecar 部署适用：GATEWAY_URL 指向非本机地址时禁用（远程网关由运维管理）
 *  - 只处理 conn-refused（进程不在）与 timeout（假死）；error 视为网络问题不拉起
 *  - 拉起后 60s 冷却期：等待进程启动 + 首轮心跳恢复，期间不重复拉起
 *  - 无二进制文件时静默跳过（用户可能用别的方式部署网关）
 */

/** 拉起后冷却期：等待网关启动与心跳恢复，避免重复 spawn */
const RESPAWN_COOLDOWN_MS = 60_000;
/** 判死后到首次尝试拉起的等待：给手动重启留出时间窗口 */
const RESPAWN_DELAY_MS = 15_000;

const GATEWAY_BIN = path.join(repoRoot, "gateway", "bin", process.platform === "win32" ? "gateway.exe" : "gateway");

let lastRespawnAt = 0;
let pendingTimer: NodeJS.Timeout | null = null;

export function gatewaySupervisionEnabled(): boolean {
  // 默认开启（GATEWAY_URL 为本地回环）；显式 GATEWAY_SUPERVISE=false 关闭
  const flag = process.env.GATEWAY_SUPERVISE;
  if (flag === "false" || flag === "0") return false;
  try {
    const url = new URL(env.gatewayURL);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function spawnGateway(): boolean {
  if (!fs.existsSync(GATEWAY_BIN)) return false;
  const child = spawn(GATEWAY_BIN, [], {
    cwd: path.dirname(GATEWAY_BIN),
    env: { ...process.env },
    stdio: "ignore",
    // Windows：子进程独立于父进程生命周期；面板退出时网关继续运行（与手动启动行为一致）
    detached: process.platform !== "win32",
  });
  child.on("error", () => {});
  child.unref();
  return true;
}

/** 心跳判定离线后调用：按需拉起网关（带冷却与延迟） */
export function maybeRespawnGateway(): void {
  if (!gatewaySupervisionEnabled()) return;
  const s = snapshot();
  if (s.up) return;
  // 只处理「进程不在/假死」两类可自愈故障
  if (s.detail !== "conn-refused" && s.detail !== "timeout") return;
  const now = Date.now();
  if (now - lastRespawnAt < RESPAWN_COOLDOWN_MS) return;
  lastRespawnAt = now;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    // 延迟期内用户手动重启导致已恢复则跳过
    if (snapshot().up) return;
    if (!fs.existsSync(GATEWAY_BIN)) {
      bus.publish({
        type: "gateway.status",
        ts: Date.now(),
        up: false,
        detail: s.detail,
        message: "网关离线且未找到网关程序（gateway/bin/），请手动构建：bun run gateway:build",
      });
      return;
    }
    const ok = spawnGateway();
    bus.publish({
      type: "gateway.status",
      ts: Date.now(),
      up: false,
      detail: s.detail,
      message: ok ? "检测到网关离线，已自动重新拉起网关进程" : "网关自动拉起失败，请手动重启网关",
    });
    // 拉起后立即探测一轮，尽快把状态翻回在线
    setTimeout(() => void refreshGatewayStatus().catch(() => {}), 3_000);
  }, RESPAWN_DELAY_MS);
}
