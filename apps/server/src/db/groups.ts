import type { AccountGroupVO } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface GroupRow {
  id: string;
  name: string;
  account_uids: string;
  created_at: string;
  [k: string]: string | number | null;
}

function parseUids(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toVO(r: GroupRow): AccountGroupVO {
  return {
    id: r.id,
    name: r.name,
    accountUids: parseUids(r.account_uids),
    createdAt: r.created_at,
  };
}

export function listGroups(): AccountGroupVO[] {
  const rows = sqlite
    .prepare(`SELECT * FROM account_groups ORDER BY created_at ASC`)
    .all() as unknown as GroupRow[];
  return rows.map(toVO);
}

export function getGroup(id: string): AccountGroupVO | null {
  const row = sqlite
    .prepare(`SELECT * FROM account_groups WHERE id = ?`)
    .get(id) as unknown as GroupRow | undefined;
  return row ? toVO(row) : null;
}

export function insertGroup(name: string, accountUids: string[]): AccountGroupVO {
  const row: GroupRow = {
    id: newId(),
    name,
    account_uids: JSON.stringify(accountUids),
    created_at: now(),
  };
  sqlite
    .prepare(`INSERT INTO account_groups (id, name, account_uids, created_at) VALUES (?, ?, ?, ?)`)
    .run(row.id, row.name, row.account_uids, row.created_at);
  return toVO(row);
}

export function updateGroup(
  id: string,
  patch: { name?: string; accountUids?: string[] },
): AccountGroupVO | null {
  const current = getGroup(id);
  if (!current) return null;
  const name = patch.name ?? current.name;
  const uids = patch.accountUids ?? current.accountUids;
  sqlite
    .prepare(`UPDATE account_groups SET name = ?, account_uids = ? WHERE id = ?`)
    .run(name, JSON.stringify(uids), id);
  return getGroup(id);
}

export function deleteGroup(id: string): boolean {
  const info = sqlite.prepare(`DELETE FROM account_groups WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

/** 删除账号时同步从所有分组移除，避免组内残留已删除的 uid */
export function removeAccountFromGroups(uid: string): void {
  const rows = sqlite.prepare(`SELECT * FROM account_groups`).all() as unknown as GroupRow[];
  for (const r of rows) {
    const uids = parseUids(r.account_uids);
    if (!uids.includes(uid)) continue;
    const rest = uids.filter((x) => x !== uid);
    sqlite
      .prepare(`UPDATE account_groups SET account_uids = ? WHERE id = ?`)
      .run(JSON.stringify(rest), r.id);
  }
}
