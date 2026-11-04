import type { JobEvent, JobState, JobSummary, JobVO, StartJobBody } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface JobRow {
  id: string;
  account_uid: string;
  options_json: string;
  state: JobState;
  started_at: string;
  finished_at: string | null;
  summary_json: string | null;
  [k: string]: string | number | null;
}

function toVO(r: JobRow & { progress_json?: string | null }, accountName?: string): JobVO {
  return {
    id: r.id,
    accountUid: r.account_uid,
    accountName,
    options: JSON.parse(r.options_json) as StartJobBody,
    state: r.state,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary_json ? (JSON.parse(r.summary_json) as JobSummary) : null,
    progress: r.progress_json ? (JSON.parse(r.progress_json) as JobEvent) : null,
  };
}

export function insertJob(options: StartJobBody): JobVO {
  const row: JobRow = {
    id: newId(),
    account_uid: options.accountUid,
    options_json: JSON.stringify(options),
    state: "running",
    started_at: now(),
    finished_at: null,
    summary_json: null,
  };
  sqlite
    .prepare(
      `INSERT INTO jobs (id, account_uid, options_json, state, started_at, finished_at, summary_json)
       VALUES (@id, @account_uid, @options_json, @state, @started_at, @finished_at, @summary_json)`,
    )
    .run(row);
  return toVO(row);
}

export function finishJob(id: string, state: JobState, summary: JobSummary): void {
  sqlite
    .prepare(`UPDATE jobs SET state = ?, finished_at = ?, summary_json = ? WHERE id = ?`)
    .run(state, now(), JSON.stringify(summary), id);
}

/**
 * 启动恢复：进程死亡（崩溃/强杀/重启）时 running 任务来不及走 finishJob，
 * 遗留的 running 行会让账号永远显示"运行中"且无法启动新任务，
 * 启动时统一标记为 error 中断。
 */
export function recoverStaleRunningJobs(): number {
  const rows = sqlite
    .prepare(`SELECT id FROM jobs WHERE state = 'running'`)
    .all() as unknown as { id: string }[];
  if (!rows.length) return 0;
  const summary: JobSummary = {
    courses: 0,
    videosCompleted: 0,
    videosSkipped: 0,
    flagsFound: 0,
    worksDone: 0,
    examsDone: 0,
    scores: [],
    errors: ["服务重启，任务被中断"],
  };
  for (const r of rows) finishJob(r.id, "error", summary);
  return rows.length;
}

export function getJob(id: string): JobVO | null {
  const row = sqlite
    .prepare(
      `SELECT j.*, p.payload_json AS progress_json
       FROM jobs j LEFT JOIN job_progress p ON p.job_id = j.id
       WHERE j.id = ?`,
    )
    .get(id) as unknown as (JobRow & { progress_json: string | null }) | undefined;
  return row ? toVO(row) : null;
}

export function listJobs(filter: { accountUid?: string; state?: string; limit?: number }): JobVO[] {
  const conds: string[] = [];
  const params: Record<string, string | number | null> = { limit: filter.limit ?? 50 };
  if (filter.accountUid) { conds.push("j.account_uid = @accountUid"); params.accountUid = filter.accountUid; }
  if (filter.state) { conds.push("j.state = @state"); params.state = filter.state; }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite
    .prepare(
      `SELECT j.*, p.payload_json AS progress_json
       FROM jobs j LEFT JOIN job_progress p ON p.job_id = j.id
       ${where} ORDER BY j.started_at DESC LIMIT @limit`,
    )
    .all(params) as unknown as (JobRow & { progress_json: string | null })[];
  return rows.map((r) => toVO(r));
}

/** 台账分页：筛选条件在服务端生效，避免分页后客户端过滤只剩当前页 */
export interface JobPageFilter {
  accountUid?: string;
  state?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export function pageJobs(filter: JobPageFilter): { items: JobVO[]; total: number } {
  const conds: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.accountUid) {
    conds.push("j.account_uid = @accountUid");
    params.accountUid = filter.accountUid;
  }
  if (filter.state) {
    conds.push("j.state = @state");
    params.state = filter.state;
  }
  if (filter.search) {
    conds.push("(j.id LIKE @search OR a.username LIKE @search OR a.remark LIKE @search)");
    params.search = `%${filter.search}%`;
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const total = (
    sqlite
      .prepare(`SELECT COUNT(*) AS c FROM jobs j LEFT JOIN accounts a ON a.uid = j.account_uid ${where}`)
      .get(params) as { c: number }
  ).c;
  const offset = (filter.page - 1) * filter.pageSize;
  const rows = sqlite
    .prepare(
      `SELECT j.*, p.payload_json AS progress_json
       FROM jobs j LEFT JOIN job_progress p ON p.job_id = j.id
       LEFT JOIN accounts a ON a.uid = j.account_uid
       ${where} ORDER BY j.started_at DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filter.pageSize, offset }) as unknown as (JobRow & { progress_json: string | null })[];
  return { items: rows.map((r) => toVO(r)), total };
}

export function countRunningByAccount(accountUid: string): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE account_uid = ? AND state = 'running'`)
    .get(accountUid) as { c: number };
  return row.c;
}

export function appendJobEvent(jobId: string, event: JobEvent): void {
  sqlite
    .prepare(
      `INSERT INTO job_events (job_id, type, payload_json, created_at, log_level, account_uid, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      jobId,
      event.type,
      JSON.stringify(event),
      now(),
      // 筛选列与 payload 同步落库，日志页按列索引过滤而非全表 json_extract
      event.level ?? "info",
      event.accountId ?? "",
      event.message ?? "",
    );
}

export function eventsForJob(jobId: string, limit = 500): JobEvent[] {
  const rows = sqlite
    .prepare(
      `SELECT payload_json FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(jobId, limit) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as JobEvent).reverse();
}

/** 覆盖写最近一次进度快照：合并保留上一次的进度字段，避免阶段事件把进度冲掉 */
export function saveJobProgress(jobId: string, event: JobEvent): void {
  const row = sqlite
    .prepare(`SELECT payload_json FROM job_progress WHERE job_id = ?`)
    .get(jobId) as { payload_json: string } | undefined;
  const merged = row
    ? { ...(JSON.parse(row.payload_json) as JobEvent), ...event }
    : event;
  sqlite
    .prepare(
      `INSERT INTO job_progress (job_id, payload_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    )
    .run(jobId, JSON.stringify(merged), now());
}

/** 全站最近日志：观测台刷新后仍能看到历史日志，而不只依赖 SSE 内存缓冲 */
export function recentLogEvents(limit = 300): JobEvent[] {
  const rows = sqlite
    .prepare(
      `SELECT payload_json FROM job_events WHERE type = 'log' ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as JobEvent).reverse();
}

export interface LogPageFilter {
  level?: string;
  accountUid?: string;
  jobId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/** 日志分页查询：级别/账号/关键字在服务端过滤，按时间倒序返回 */
export function pageLogEvents(filter: LogPageFilter): { items: JobEvent[]; total: number } {
  const conds: string[] = ["type = 'log'"];
  const params: Record<string, string | number> = {};
  if (filter.level && filter.level !== "all") {
    if (filter.level === "info") {
      // debug 归入信息级别，与前端「信息」标签的统计口径保持一致
      conds.push("log_level IN ('info', 'debug')");
    } else {
      conds.push("log_level = @level");
      params.level = filter.level;
    }
  }
  if (filter.accountUid) {
    conds.push("account_uid = @accountUid");
    params.accountUid = filter.accountUid;
  }
  if (filter.jobId) {
    conds.push("job_id = @jobId");
    params.jobId = filter.jobId;
  }
  if (filter.search) {
    conds.push("message LIKE @search");
    params.search = `%${filter.search}%`;
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const total = (
    sqlite.prepare(`SELECT COUNT(*) AS c FROM job_events ${where}`).get(params) as { c: number }
  ).c;
  const offset = (filter.page - 1) * filter.pageSize;
  const rows = sqlite
    .prepare(
      `SELECT payload_json FROM job_events ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filter.pageSize, offset }) as { payload_json: string }[];
  return { items: rows.map((r) => JSON.parse(r.payload_json) as JobEvent), total };
}

/** 按时间段删除日志（[from, to)，时间均为 ISO 字符串）；保护规则由路由层校验 */
export function deleteLogEvents(from: string, to: string): number {
  const info = sqlite
    .prepare(`DELETE FROM job_events WHERE type = 'log' AND created_at >= ? AND created_at < ?`)
    .run(from, to);
  return Number(info.changes);
}
