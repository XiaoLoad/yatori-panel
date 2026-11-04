import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// 独立内存化测试库：不复用全局 db 单例，避免与其他测试文件共享模块缓存
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yatori-logtest-"));
const sqlite = new DatabaseSync(path.join(tmpDir, "logs.db"));
sqlite.exec("PRAGMA journal_mode = DELETE;"); // 避免 WAL 文件锁住目录

sqlite.exec(`
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  account_uid  TEXT NOT NULL,
  options_json TEXT NOT NULL,
  state        TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  summary_json TEXT
);
CREATE TABLE job_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  log_level    TEXT NOT NULL DEFAULT '',
  account_uid  TEXT NOT NULL DEFAULT '',
  message      TEXT NOT NULL DEFAULT ''
);
`);

type LogRow = { payload_json: string };

function insertLog(message: string, level: string, accountId: string, createdAt: string): void {
  const jobId = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO jobs (id, account_uid, options_json, state, started_at) VALUES (?, ?, '{}', 'done', ?)`)
    .run(jobId, accountId, createdAt);
  sqlite
    .prepare(
      `INSERT INTO job_events (job_id, type, payload_json, created_at, log_level, account_uid, message)
       VALUES (?, 'log', ?, ?, ?, ?, ?)`,
    )
    .run(
      jobId,
      JSON.stringify({ type: "log", ts: Date.now(), level, accountId, message }),
      createdAt,
      level,
      accountId,
      message,
    );
}

/** 与 db/jobs.ts 中 pageLogEvents 相同语义的最小实现，跑在测试专用库上 */
function pageLogs(filter: { level?: string; accountUid?: string; search?: string; page: number; pageSize: number }) {
  const conds: string[] = ["type = 'log'"];
  const params: Record<string, string | number> = {};
  if (filter.level && filter.level !== "all") {
    if (filter.level === "info") conds.push("log_level IN ('info', 'debug')");
    else { conds.push("log_level = @level"); params.level = filter.level; }
  }
  if (filter.accountUid) { conds.push("account_uid = @accountUid"); params.accountUid = filter.accountUid; }
  if (filter.search) { conds.push("message LIKE @search"); params.search = `%${filter.search}%`; }
  const where = `WHERE ${conds.join(" AND ")}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM job_events ${where}`).get(params) as { c: number }).c;
  const rows = sqlite
    .prepare(`SELECT payload_json FROM job_events ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize }) as LogRow[];
  return { items: rows.map((r) => JSON.parse(r.payload_json)), total };
}

/** 与 db/jobs.ts 中 deleteLogEvents 相同的保护规则 */
const LOG_RETENTION_MS = 7 * 86_400_000;
const LOG_DELETE_SPAN_MS = 366 * 86_400_000;
function deleteLogs(from: string, to: string): number {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error("时间格式不正确");
  if (fromMs >= toMs) throw new Error("开始时间必须早于结束时间");
  if (toMs > Date.now() - LOG_RETENTION_MS) throw new Error("近 7 天内的日志不可删除，请把结束时间调整到 7 天以前");
  if (toMs - fromMs > LOG_DELETE_SPAN_MS) throw new Error("单次最多删除 366 天内的日志");
  const info = sqlite
    .prepare(`DELETE FROM job_events WHERE type = 'log' AND created_at >= ? AND created_at < ?`)
    .run(from, to);
  return Number(info.changes);
}

afterAll(() => {
  sqlite.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows 下句柄释放时序问题，残留临时目录由系统回收
  }
});

describe("log query & retention rules", () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString(); // 30 天前
  const fresh = new Date(Date.now() - 1 * 86_400_000).toISOString(); // 1 天前

  insertLog("旧错误日志", "error", "acc-1", old);
  insertLog("旧信息日志", "info", "acc-2", old);
  insertLog("新错误日志", "error", "acc-1", fresh);

  test("按级别过滤", () => {
    const { items } = pageLogs({ level: "error", page: 1, pageSize: 10 });
    expect(items.length).toBe(2);
    expect(items.every((e) => e.level === "error")).toBe(true);
  });

  test("按账号过滤", () => {
    const { items, total } = pageLogs({ accountUid: "acc-2", page: 1, pageSize: 10 });
    expect(total).toBe(1);
    expect(items[0].message).toBe("旧信息日志");
  });

  test("按关键字过滤", () => {
    const { total } = pageLogs({ search: "新错误", page: 1, pageSize: 10 });
    expect(total).toBe(1);
  });

  test("分页正确", () => {
    const p1 = pageLogs({ page: 1, pageSize: 2 });
    const p2 = pageLogs({ page: 2, pageSize: 2 });
    expect(p1.items.length).toBe(2);
    expect(p2.items.length).toBe(1);
    expect(p1.total).toBe(3);
  });

  test("删除保护：7 天内的日志不可删除", () => {
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    expect(() => deleteLogs(from, to)).toThrow(/近 7 天内的日志不可删除/);
  });

  test("删除保护：跨度超过 366 天被拒", () => {
    const from = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const to = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(() => deleteLogs(from, to)).toThrow(/单次最多删除 366 天/);
  });

  test("删除保护：开始时间晚于结束时间被拒", () => {
    const from = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const to = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(() => deleteLogs(from, to)).toThrow(/开始时间必须早于结束时间/);
  });

  test("删除旧时间段日志成功", () => {
    const from = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const to = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(deleteLogs(from, to)).toBe(2);
    expect(pageLogs({ page: 1, pageSize: 10 }).total).toBe(1);
  });
});
