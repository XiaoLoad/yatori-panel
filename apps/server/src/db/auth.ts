import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.ts";
import { now, sqlite } from "./index.ts";

// 会话签名与密码加密共用机器本地密钥（data/secret.key），由 db/crypto.ts 创建
function machineKey(): Buffer {
  return fs.readFileSync(path.join(env.dataDir, "secret.key"));
}

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const SESSION_COOKIE = "panel_session";

interface PanelAuth {
  hash: string;
  salt: string;
}

function readPanelAuth(): PanelAuth | null {
  const row = sqlite
    .prepare(`SELECT value_json FROM settings WHERE key = 'panelAuth'`)
    .get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as PanelAuth) : null;
}

export function authRequired(): boolean {
  return readPanelAuth() !== null;
}

export function setPassword(password: string): void {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  sqlite
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES ('panelAuth', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(JSON.stringify({ hash: hash.toString("hex"), salt: salt.toString("hex") }));
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
  return !Number.isNaN(expires.getTime()) && expires.getTime() > Date.now();
}

export function revokeAllSessions(): void {
  bumpEpoch();
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
