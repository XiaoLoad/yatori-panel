import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../env.ts";

fs.mkdirSync(env.dataDir, { recursive: true });
export const sqlite = new DatabaseSync(path.join(env.dataDir, "yatori-panel.db"));
sqlite.exec("PRAGMA journal_mode = WAL;");

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
`);

// 清理已删除账号遗留的进度快照（防止假数据残留影响后续判断）
sqlite.exec(`DELETE FROM node_cache WHERE account_uid NOT IN (SELECT uid FROM accounts);`);

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
