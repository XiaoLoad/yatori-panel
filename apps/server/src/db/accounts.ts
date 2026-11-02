import type { AccountVO } from "../shared.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { newId, now, sqlite } from "./index.ts";

interface AccountRow {
  uid: string;
  platform: string;
  base_url: string;
  username: string;
  password_enc: string;
  remark: string;
  enabled: number;
  proxy_url: string;
  last_verify_at: string | null;
  last_verify_ok: number | null;
  created_at: string;
  [k: string]: string | number | null;
}

const PLATFORM_NAMES: Record<string, string> = {
  YINGHUA: "英华学堂",
  XUEXITONG: "超星学习通",
};

function toVO(r: AccountRow): AccountVO & { password: string } {
  let password = "";
  try {
    password = decryptSecret(r.password_enc);
  } catch {
    password = ""; // 密钥更换等极端情况：让上层走"重新保存密码"流程
  }
  return {
    uid: r.uid,
    platform: r.platform,
    platformName: PLATFORM_NAMES[r.platform] ?? r.platform,
    baseUrl: r.base_url,
    proxyUrl: r.proxy_url,
    username: r.username,
    password,
    remark: r.remark,
    enabled: r.enabled === 1,
    lastVerifyAt: r.last_verify_at,
    lastVerifyOk: r.last_verify_ok,
    createdAt: r.created_at,
  };
}

export function insertAccount(input: {
  platform: string;
  baseUrl: string;
  username: string;
  password: string;
  remark: string;
  proxyUrl?: string;
}): AccountVO {
  const row: AccountRow = {
    uid: newId(),
    platform: input.platform,
    base_url: input.baseUrl,
    proxy_url: input.proxyUrl ?? "",
    username: input.username,
    password_enc: encryptSecret(input.password),
    remark: input.remark,
    enabled: 1,
    last_verify_at: null,
    last_verify_ok: null,
    created_at: now(),
  };
  sqlite
    .prepare(
      `INSERT INTO accounts (uid, platform, base_url, username, password_enc, remark, proxy_url, enabled, last_verify_at, last_verify_ok, created_at)
       VALUES (@uid, @platform, @base_url, @username, @password_enc, @remark, @proxy_url, @enabled, @last_verify_at, @last_verify_ok, @created_at)`,
    )
    .run(row);
  const { password, ...vo } = toVO(row);
  void password;
  return vo;
}

export function getAccount(uid: string): (AccountVO & { password: string }) | null {
  const row = sqlite
    .prepare(`SELECT * FROM accounts WHERE uid = ?`)
    .get(uid) as unknown as AccountRow | undefined;
  return row ? toVO(row) : null;
}

export function listAccounts(): AccountVO[] {
  const rows = sqlite
    .prepare(`SELECT * FROM accounts ORDER BY created_at DESC`)
    .all() as unknown as AccountRow[];
  return rows.map((r) => {
    const { password, ...vo } = toVO(r);
    void password;
    return vo;
  });
}

export function updateAccount(
  uid: string,
  patch: { baseUrl?: string; username?: string; password?: string; remark?: string; enabled?: boolean; proxyUrl?: string },
): void {
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { uid };
  if (patch.baseUrl !== undefined) { sets.push("base_url = @baseUrl"); params.baseUrl = patch.baseUrl; }
  if (patch.proxyUrl !== undefined) { sets.push("proxy_url = @proxyUrl"); params.proxyUrl = patch.proxyUrl; }
  if (patch.username !== undefined) { sets.push("username = @username"); params.username = patch.username; }
  if (patch.password !== undefined && patch.password !== "") {
    sets.push("password_enc = @passwordEnc");
    params.passwordEnc = encryptSecret(patch.password);
  }
  if (patch.remark !== undefined) { sets.push("remark = @remark"); params.remark = patch.remark; }
  if (patch.enabled !== undefined) { sets.push("enabled = @enabled"); params.enabled = patch.enabled ? 1 : 0; }
  if (sets.length === 0) return;
  sqlite.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE uid = @uid`).run(params);
}

export function deleteAccount(uid: string): void {
  sqlite.prepare(`DELETE FROM accounts WHERE uid = ?`).run(uid);
}

export function markVerify(uid: string, ok: boolean): void {
  sqlite
    .prepare(`UPDATE accounts SET last_verify_at = ?, last_verify_ok = ? WHERE uid = ?`)
    .run(now(), ok ? 1 : 0, uid);
}

export function countAccountsByPlatform(platform: string, baseUrl: string, username: string): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM accounts WHERE platform = ? AND base_url = ? AND username = ?`,
    )
    .get(platform, baseUrl, username) as { c: number };
  return row.c;
}
