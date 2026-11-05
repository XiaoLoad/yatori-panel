import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../env.ts";

fs.mkdirSync(env.dataDir, { recursive: true });
export const sqlite = new DatabaseSync(path.join(env.dataDir, "yatori-panel.db"));
sqlite.exec("PRAGMA journal_mode = WAL;");

// 基础表结构保持首版定义；后续新增列/索引一律走下方版本化迁移，
// 保证旧库升级与新库初始化走同一条路径。
sqlite.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  uid            TEXT PRIMARY KEY,
  platform       TEXT NOT NULL,
  base_url       TEXT NOT NULL DEFAULT '',
  username       TEXT NOT NULL,
  password_enc   TEXT NOT NULL,
  remark         TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_verify_at TEXT,
  last_verify_ok INTEGER,
  created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  account_uid  TEXT NOT NULL,
  options_json TEXT NOT NULL,
  state        TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  summary_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_uid, started_at DESC);
CREATE TABLE IF NOT EXISTS job_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id);
CREATE INDEX IF NOT EXISTS idx_job_events_log ON job_events(type, id DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_log_created ON job_events(type, created_at);
CREATE TABLE IF NOT EXISTS job_progress (
  job_id       TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_cache (
  account_uid TEXT NOT NULL,
  course_id   TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT '',
  progress    REAL NOT NULL DEFAULT 0,
  completed   INTEGER NOT NULL DEFAULT 0,
  flagged     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (account_uid, course_id, node_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,
  account_uid   TEXT NOT NULL,
  cron          TEXT NOT NULL,
  video_mode    INTEGER NOT NULL DEFAULT 1,
  answer_source TEXT NOT NULL DEFAULT 'off',
  auto_submit   INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_job_links (
  schedule_id  TEXT NOT NULL,
  batch_id     TEXT NOT NULL,
  job_id       TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  PRIMARY KEY (schedule_id, batch_id, job_id)
);
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 清理已删除账号遗留的进度快照（防止假数据残留影响后续判断）
sqlite.exec(`DELETE FROM node_cache WHERE account_uid NOT IN (SELECT uid FROM accounts);`);

/**
 * 补列：先用 PRAGMA 判断列是否已存在，避免依赖 SQLite 错误文本。
 * 原先整块 try/catch 会静默吞掉错误，导致同一块内的索引与回填语句被一并跳过。
 * 返回是否真的新增了列，供「仅新建时回填」判断使用。
 */
function addColumn(table: string, column: string, definition: string): boolean {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function schemaVersion(): number {
  const row = sqlite
    .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined;
  const n = row ? Number(row.value) : 0;
  return Number.isFinite(n) ? n : 0;
}

function setSchemaVersion(v: number): void {
  sqlite
    .prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(v));
}

const LATEST_SCHEMA_VERSION = 2;
const currentVersion = schemaVersion();
if (currentVersion > LATEST_SCHEMA_VERSION) {
  throw new Error(
    `数据库 schema 版本 ${currentVersion} 高于当前程序支持的 ${LATEST_SCHEMA_VERSION}，请升级程序后再启动`,
  );
}

// 迁移整体包事务：任一步失败全部回滚，不会留下半迁移的库
sqlite.exec("BEGIN");
try {
  // v1：首版之后陆续补充的列与日志筛选列回填
  if (currentVersion < 1) {
    addColumn("accounts", "proxy_url", "TEXT NOT NULL DEFAULT ''");

    if (addColumn("schedules", "submit_mode", "TEXT NOT NULL DEFAULT 'off'")) {
      sqlite.exec(`UPDATE schedules SET submit_mode = CASE WHEN auto_submit = 1 THEN 'direct' ELSE 'off' END`);
    }
    addColumn("schedules", "account_uids", "TEXT NOT NULL DEFAULT '[]'");
    const scheduleRows = sqlite
      .prepare(`SELECT id, account_uid, account_uids FROM schedules`)
      .all() as { id: string; account_uid: string; account_uids: string }[];
    const fillUids = sqlite.prepare(`UPDATE schedules SET account_uids = ? WHERE id = ?`);
    for (const r of scheduleRows) {
      if (r.account_uids === "[]" || !r.account_uids) {
        fillUids.run(JSON.stringify([r.account_uid]), r.id);
      }
    }
    addColumn("schedules", "end_time", "TEXT");
    addColumn("schedules", "stop_mode", "TEXT NOT NULL DEFAULT 'finish_current'");
    addColumn("schedules", "name", "TEXT NOT NULL DEFAULT ''");

    addColumn("job_events", "log_level", "TEXT NOT NULL DEFAULT ''");
    addColumn("job_events", "account_uid", "TEXT NOT NULL DEFAULT ''");
    addColumn("job_events", "message", "TEXT NOT NULL DEFAULT ''");
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_job_events_log_filter ON job_events(type, log_level, account_uid, id DESC)`);
    sqlite.exec(`
      UPDATE job_events
      SET log_level = COALESCE(json_extract(payload_json, '$.level'), 'info'),
          account_uid = COALESCE(json_extract(payload_json, '$.accountId'), ''),
          message = COALESCE(json_extract(payload_json, '$.message'), '')
      WHERE type = 'log' AND log_level = ''
    `);
    setSchemaVersion(1);
  }

  // v2：任务产出列 + 查询索引 + 定时任务批次索引
  if (currentVersion < 2) {
    addColumn("jobs", "videos_completed", "INTEGER NOT NULL DEFAULT 0");
    sqlite.exec(`
      UPDATE jobs
      SET videos_completed = COALESCE(CAST(json_extract(summary_json, '$.videosCompleted') AS INTEGER), 0)
      WHERE videos_completed = 0 AND summary_json IS NOT NULL
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, started_at DESC)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_job_events_created ON job_events(created_at)`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_job_links_recent ON schedule_job_links(schedule_id, triggered_at DESC)`);
    setSchemaVersion(2);
  }
  sqlite.exec("COMMIT");
} catch (err) {
  sqlite.exec("ROLLBACK");
  throw err;
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
