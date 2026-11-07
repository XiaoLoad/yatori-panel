import crypto from "node:crypto";
import { env } from "../env.ts";
import { now, sqlite } from "./index.ts";
import { machineKey } from "./key.ts";

export const SESSION_COOKIE = "panel_session";
const SESSION_TTL_MS = env.sessionTtlHours * 3600 * 1000;

interface PanelAuth {
  hash: string;
  salt: string;
  /** 初始密码由系统自动生成时为 true；用户主动改密后清除 */
  generated?: boolean;
}

function readPanelAuth(): PanelAuth | null {
  const row = sqlite
    .prepare(`SELECT value_json FROM settings WHERE key = 'panelAuth'`)
    .get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as PanelAuth) : null;
}

/** 当前访问密码是否为系统自动生成的初始密码（未由用户改过） */
export function isGeneratedPassword(): boolean {
  return readPanelAuth()?.generated === true;
}

// authRequired 在每个请求的鉴权钩子里都会调用：缓存 5s，避免逐请求查 SQLite。
// 缓存期间改密/关锁最多延迟 5s 生效，对安全无实质影响（会话校验始终实时）。
let authRequiredCache: { value: boolean; at: number } | null = null;
const AUTH_REQUIRED_CACHE_MS = 5_000;

export function authRequired(): boolean {
  const nowMs = Date.now();
  if (authRequiredCache && nowMs - authRequiredCache.at < AUTH_REQUIRED_CACHE_MS) {
    return authRequiredCache.value;
  }
  const value = readPanelAuth() !== null;
  authRequiredCache = { value, at: nowMs };
  return value;
}

function invalidateAuthRequiredCache(): void {
  authRequiredCache = null;
}

/**
 * 密码强度：至少 8 位，且至少包含字母/数字/其他字符中的两类。
 * 返回错误提示，通过校验返回 null。
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  const kinds =
    (/[a-zA-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(password) ? 1 : 0);
  if (kinds < 2) return "密码需包含字母、数字、符号中的至少两类";
  return null;
}

/** 生成可读性较好的随机密码（去掉易混淆字符），24 字符，用于强制访问锁的首次自动启用 */
export function generateRandomPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
}

export function setPassword(password: string, opts?: { generated?: boolean }): void {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  sqlite
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('panelAuth', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify({ hash: hash.toString("hex"), salt: salt.toString("hex"), generated: opts?.generated === true }));
  invalidateAuthRequiredCache();
}

export function clearPassword(): void {
  sqlite.prepare(`DELETE FROM settings WHERE key = 'panelAuth'`).run();
  invalidateAuthRequiredCache();
}

export function verifyPassword(password: string): boolean {
  const auth = readPanelAuth();
  if (!auth) return false;
  const test = crypto.scryptSync(password, Buffer.from(auth.salt, "hex"), 32);
  const expect = Buffer.from(auth.hash, "hex");
  return test.length === expect.length && crypto.timingSafeEqual(test, expect);
}

// 会话纪元：登出时递增，使所有已发 token 立即失效（无状态 token 的吊销手段）
function sessionEpoch(): number {
  const row = sqlite
    .prepare(`SELECT value_json FROM settings WHERE key = 'panelSessionEpoch'`)
    .get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as { n: number }).n : 1;
}

function bumpEpoch(): void {
  const next = sessionEpoch() + 1;
  sqlite
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('panelSessionEpoch', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify({ n: next }));
}

export function issueSession(): { token: string; expires: Date } {
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  const epoch = sessionEpoch();
  const sig = crypto
    .createHmac("sha256", machineKey())
    .update(`panel:${epoch}:${expires.toISOString()}`)
    .digest("hex");
  return { token: `${epoch}:${expires.toISOString()}.${sig}`, expires };
}

// ---------- 登录会话注册表（schema v7） ----------
// token 仍是 HMAC 无状态格式（签名校验在前，注册表校验在后），
// 落表只为三件事：已登录设备可枚举、单设备可吊销、最近活跃可见。
// 表里只存 token 的 sha256，泄露数据库也无法还原 cookie。

function tokenId(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** token → 注册表 id（路由层下线当前设备时需要） */
export function sessionIdOf(token: string): string {
  return tokenId(token);
}

export interface LoginSessionVO {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  /** 当前请求自己的会话（前端据此标注「本机」） */
  current?: boolean;
}

/** 登录成功后登记会话（同 token 幂等——浏览器重放同一 cookie 不重复计设备） */
export function registerSession(
  token: string,
  meta: { ip?: string; userAgent?: string } = {},
): void {
  const expires = tokenToExpires(token);
  if (!expires) return;
  sqlite
    .prepare(
      `INSERT INTO login_sessions (id, ip, user_agent, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      tokenId(token),
      meta.ip ?? "",
      (meta.userAgent ?? "").slice(0, 200),
      now(),
      expires,
      now(),
    );
}

function tokenToExpires(token: string): string | null {
  const colon = token.indexOf(":");
  const dot = token.lastIndexOf(".");
  if (colon <= 0 || dot <= colon) return null;
  const expiresISO = token.slice(colon + 1, dot);
  const t = new Date(expiresISO).getTime();
  return Number.isFinite(t) ? expiresISO : null;
}

/** 活跃会话列表（未吊销且未过期），新近活跃在前 */
export function listSessions(currentToken?: string): LoginSessionVO[] {
  pruneSessions();
  const rows = sqlite
    .prepare(
      `SELECT id, ip, user_agent, created_at, expires_at, last_seen_at
       FROM login_sessions WHERE revoked = 0 AND expires_at > ?
       ORDER BY last_seen_at DESC`,
    )
    .all(now()) as unknown as {
    id: string;
    ip: string;
    user_agent: string;
    created_at: string;
    expires_at: string;
    last_seen_at: string;
  }[];
  const currentId = currentToken ? tokenId(currentToken) : "";
  return rows.map((r) => ({
    id: r.id,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
    current: r.id === currentId,
  }));
}

/** 吊销单个会话（已登录设备下线）；返回是否存在且确实在册 */
export function revokeSession(id: string): boolean {
  const info = sqlite
    .prepare(`UPDATE login_sessions SET revoked = 1 WHERE id = ? AND revoked = 0`)
    .run(id);
  return Number(info.changes) > 0;
}

/** 吊销当前 token 之外的全部会话 */
export function revokeOtherSessions(currentToken: string | undefined): number {
  if (!currentToken) return 0;
  const info = sqlite
    .prepare(`UPDATE login_sessions SET revoked = 1 WHERE id != ? AND revoked = 0`)
    .run(tokenId(currentToken));
  return Number(info.changes);
}

/** 清理过期会话行；纪元变更（全量吊销）后的旧行也一并清掉 */
export function pruneSessions(): void {
  sqlite
    .prepare(`DELETE FROM login_sessions WHERE expires_at <= ? OR revoked = 1`)
    .run(now());
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  const colon = token.indexOf(":");
  if (dot <= 0 || colon <= 0 || colon > dot) return false;
  const epoch = token.slice(0, colon);
  const expiresISO = token.slice(colon + 1, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expect = Buffer.from(
    crypto
      .createHmac("sha256", machineKey())
      .update(`panel:${epoch}:${expiresISO}`)
      .digest("hex"),
  );
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return false;
  if (Number(epoch) !== sessionEpoch()) return false;
  const expires = new Date(expiresISO);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return false;
  // 注册表校验：签名合法但已被单独下线（revoked）的 token 立即失效。
  // 旧版本升级后存量 cookie 首次访问时自动登记，不强制重新登录。
  const row = sqlite
    .prepare(`SELECT revoked FROM login_sessions WHERE id = ?`)
    .get(tokenId(token)) as { revoked: number } | undefined;
  if (!row) {
    registerSession(token);
    return true;
  }
  return row.revoked === 0;
}

export function revokeAllSessions(): void {
  bumpEpoch();
  // 全量吊销后注册表整体作废，直接清空（纪元校验已让旧 token 全部失效）
  sqlite.prepare(`DELETE FROM login_sessions`).run();
}

// ---------- 最近活跃时间刷新（内存聚合，60s 批量落库） ----------
// verifySession 在每个 API 请求上都会跑，逐请求 UPDATE 会放大 SQLite 写放大，
// 这里内存缓存最近一次落库时间，超过间隔才写一次。

const seenBuffer = new Map<string, string>();
let lastSeenFlushedAt = 0;
const LAST_SEEN_FLUSH_MS = 60_000;

function flushSeen(): void {
  if (!seenBuffer.size) return;
  const update = sqlite.prepare(`UPDATE login_sessions SET last_seen_at = ? WHERE id = ? AND revoked = 0`);
  for (const [id, at] of seenBuffer) update.run(at, id);
  seenBuffer.clear();
}

export function touchSessionSeen(token: string): void {
  const id = tokenId(token);
  const at = now();
  const prev = seenBuffer.get(id);
  // 60s 内只推进一次，避免高频请求反复覆盖
  if (prev && at < prev) return;
  seenBuffer.set(id, at);
  const nowMs = Date.now();
  if (nowMs - lastSeenFlushedAt >= LAST_SEEN_FLUSH_MS) {
    lastSeenFlushedAt = nowMs;
    flushSeen();
  }
}

export function touchAuthStamp(): void {
  // 记录最近一次凭据变更，便于排查（无敏感内容）
  sqlite
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('panelAuthStamp', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify({ at: now() }));
}
