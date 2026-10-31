import type { AccountVO } from "./shared.ts";
import type { GatewayLogEntry } from "./gateway.ts";
import { bus } from "./bus.ts";
import { getSettings } from "./db/settings.ts";
import { env } from "./env.ts";
import { gateway } from "./gateway.ts";

interface LiveSession {
  sessionId: string;
  stopLogs: () => void;
}

/** accountUid → 网关会话。会话即登录态，进程重启后惰性重建。 */
const live = new Map<string, LiveSession>();

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

/**
 * 确保账号有一个存活会话（没有则创建并登录）。
 * 登录失败抛 GatewayError（带网关返回的 OCR 过程日志）。
 */
export async function ensureSession(
  account: AccountVO & { password: string },
): Promise<string> {
  const existing = live.get(account.uid);
  if (existing) return existing.sessionId;

  const settings = getSettings();
  const info = await gateway.createSession({
    platform: account.platform,
    username: account.username,
    password: account.password,
    url: account.baseUrl || undefined,
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

  const stopLogs = await attachLogForwarder(account.uid, info.sessionId);
  live.set(account.uid, { sessionId: info.sessionId, stopLogs });
  bus.publish({
    type: "account.state",
    ts: Date.now(),
    accountId: account.uid,
    message: "online",
  });
  return info.sessionId;
}

export function getSessionId(accountUid: string): string | undefined {
  return live.get(accountUid)?.sessionId;
}

export async function dropSession(accountUid: string): Promise<void> {
  const s = live.get(accountUid);
  if (!s) return;
  live.delete(accountUid);
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
