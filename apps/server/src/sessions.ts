import type { AccountVO } from "./shared.ts";
import type { GatewayLogEntry } from "./gateway.ts";
import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { getSettings } from "./db/settings.ts";
import { env } from "./env.ts";
import { GatewayError, gateway } from "./gateway.ts";
import { HttpError } from "./errors.ts";

interface LiveSession {
  sessionId: string;
  stopLogs: () => void;
}

/** accountUid → 网关会话。会话即登录态，进程重启后惰性重建。 */
const live = new Map<string, LiveSession>();
/** accountUid → 网关侧会话状态（logging_in / online / error） */
const sessionStates = new Map<string, string>();

/** 把网关 SSE 日志流转发进面板事件总线（log 事件）。 */
async function attachLogForwarder(
  accountUid: string,
  sessionId: string,
): Promise<() => void> {
  const ac = new AbortController();
  void (async () => {
    try {
      const res = await fetch(
        `${env.gatewayURL}/api/v1/sessions/${sessionId}/logs`,
        { signal: ac.signal },
      );
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const entry = JSON.parse(line.slice(6)) as GatewayLogEntry;
              bus.publish({
                type: "log",
                ts: Date.now(),
                accountId: accountUid,
                level: entry.level,
                message: entry.message,
              });
            } catch {
              /* 忽略不完整帧 */
            }
          }
        }
      }
    } catch {
      /* 流结束/中断：日志仍可经 recentLogs 兜底 */
    }
  })();
  return () => ac.abort();
}

/** 轮询网关会话直到登录完成或失败（登录已异步化） */
async function waitForOnline(sessionId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await gateway.sessionInfo(sessionId);
    const state = info.info.state;
    sessionStates.set(sessionId, state);
    if (state === "online") return;
    if (state === "error") {
      const logs = await gateway.recentLogs(sessionId).catch(() => []);
      throw new GatewayError(info.info.lastError || "登录失败", 401, logs);
    }
    if (Date.now() > deadline) {
      throw new GatewayError("登录超时", 504);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * 确保账号有一个存活会话：
 * 1. 面板内已有 → 直接复用
 * 2. 网关侧有同平台同账号的在线会话（面板重启后遗留）→ 认领，避免重复登录
 * 3. 都没有 → 创建并等待登录完成（登录日志实时转发）
 */
export async function ensureSession(
  account: AccountVO & { password: string },
): Promise<string> {
  const existing = live.get(account.uid);
  if (existing) return existing.sessionId;

  // 认领网关侧现存会话（面板重启后网关进程未重启的场景）
  try {
    const listed = await gateway.sessions();
    const match = listed.find(
      (s) =>
        s.state === "online" &&
        s.platform === account.platform &&
        s.account === account.username,
    );
    if (match) {
      const stopLogs = await attachLogForwarder(account.uid, match.sessionId);
      live.set(account.uid, { sessionId: match.sessionId, stopLogs });
      sessionStates.set(match.sessionId, "online");
      bus.publish({
        type: "account.state",
        ts: Date.now(),
        accountId: account.uid,
        message: "online（认领现存会话）",
      });
      return match.sessionId;
    }
  } catch {
    /* 网关列表拉取失败则走创建路径 */
  }

  const settings = getSettings();
  const created = await gateway.createSession({
    platform: account.platform,
    username: account.username,
    password: account.password,
    url: account.baseUrl || undefined,
    proxyURL: account.proxyUrl || undefined,
    loginTimeoutSeconds: 90,
    ai:
      settings.ai.enabled && settings.ai.apiKey
        ? {
            type: settings.ai.type,
            url: settings.ai.url,
            model: settings.ai.model,
            apiKey: settings.ai.apiKey,
          }
        : undefined,
    questionBank:
      settings.questionBank.enabled && settings.questionBank.url
        ? {
            url: settings.questionBank.url,
            key: settings.questionBank.key,
          }
        : undefined,
  });

  // 会话已入库（logging_in）：日志转发立即挂上，登录过程实时可见
  const stopLogs = await attachLogForwarder(account.uid, created.sessionId);
  sessionStates.set(created.sessionId, "logging_in");
  live.set(account.uid, { sessionId: created.sessionId, stopLogs });

  try {
    await waitForOnline(created.sessionId, 120_000);
  } catch (err) {
    // 登录失败：从 live 移除（网关侧会话保留 error 状态供日志查询）
    live.delete(account.uid);
    throw err;
  }

  live.set(account.uid, { sessionId: created.sessionId, stopLogs });
  bus.publish({
    type: "account.state",
    ts: Date.now(),
    accountId: account.uid,
    message: "online",
  });
  return created.sessionId;
}

export function getSessionId(accountUid: string): string | undefined {
  return live.get(accountUid)?.sessionId;
}

/** 按账号 uid 确保会话存在（runner 用，内部读库取凭据） */
export async function ensureSessionForUid(accountUid: string): Promise<string> {
  const existing = live.get(accountUid);
  if (existing) return existing.sessionId;
  const account = getAccount(accountUid);
  if (!account) throw new HttpError(404, "账号不存在");
  return ensureSession(account);
}

/**
 * 会话失效重建：丢弃旧会话（含其心跳），重新走完整登录。
 * 用于 runner 检测到「账号登录超时，请重新登录」时的自愈。
 */
export async function rebuildSession(accountUid: string): Promise<string> {
  await dropSession(accountUid);
  return ensureSessionForUid(accountUid);
}

export function getSessionState(accountUid: string): string | undefined {
  return sessionStates.get(accountUid);
}

export async function dropSession(accountUid: string): Promise<void> {
  const s = live.get(accountUid);
  if (!s) return;
  live.delete(accountUid);
  sessionStates.delete(s.sessionId);
  s.stopLogs();
  try {
    await gateway.closeSession(s.sessionId);
  } catch {
    /* 网关侧可能已消失 */
  }
  bus.publish({
    type: "account.state",
    ts: Date.now(),
    accountId: accountUid,
    message: "offline",
  });
}

export async function dropAllSessions(): Promise<void> {
  for (const uid of [...live.keys()]) {
    await dropSession(uid);
  }
}
