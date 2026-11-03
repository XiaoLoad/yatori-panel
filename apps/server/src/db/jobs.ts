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

function toVO(r: JobRow, accountName?: string): JobVO {
  return {
    id: r.id,
    accountUid: r.account_uid,
    accountName,
    options: JSON.parse(r.options_json) as StartJobBody,
    state: r.state,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary_json ? (JSON.parse(r.summary_json) as JobSummary) : null,
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
  const row = sqlite.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as unknown as JobRow | undefined;
  return row ? toVO(row) : null;
}

export function listJobs(filter: { accountUid?: string; state?: string; limit?: number }): JobVO[] {
  const conds: string[] = [];
  const params: Record<string, string | number | null> = { limit: filter.limit ?? 50 };
  if (filter.accountUid) { conds.push("account_uid = @accountUid"); params.accountUid = filter.accountUid; }
  if (filter.state) { conds.push("state = @state"); params.state = filter.state; }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = sqlite
    .prepare(`SELECT * FROM jobs ${where} ORDER BY started_at DESC LIMIT @limit`)
    .all(params) as unknown as JobRow[];
  return rows.map((r) => toVO(r));
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
      `INSERT INTO job_events (job_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(jobId, event.type, JSON.stringify(event), now());
}

export function eventsForJob(jobId: string, limit = 500): JobEvent[] {
  const rows = sqlite
    .prepare(
      `SELECT payload_json FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(jobId, limit) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as JobEvent).reverse();
}
