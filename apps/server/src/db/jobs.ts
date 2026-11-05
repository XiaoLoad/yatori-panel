import type { FailureBreakdown, FailureCategory, FailureReason, JobEvent, JobState, JobSummary, JobVO, StartJobBody } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface JobRow {
  id: string;
  account_uid: string;
  options_json: string;
  state: JobState;
  started_at: string;
  finished_at: string | null;
  summary_json: string | null;
  videos_completed: number;
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
    videos_completed: 0,
  };
  sqlite
    .prepare(
      `INSERT INTO jobs (id, account_uid, options_json, state, started_at, finished_at, summary_json, videos_completed)
       VALUES (@id, @account_uid, @options_json, @state, @started_at, @finished_at, @summary_json, @videos_completed)`,
    )
    .run(row);
  return toVO(row);
}

export function finishJob(id: string, state: JobState, summary: JobSummary): void {
  sqlite
    .prepare(
      `UPDATE jobs SET state = ?, finished_at = ?, summary_json = ?, videos_completed = ? WHERE id = ?`,
    )
    .run(state, now(), JSON.stringify(summary), summary.videosCompleted, id);
}

// ---------- 失败原因看板 ----------
// 既有 summary.errors 只存文本；这里按关键字做轻量归类，不改动运行器产出的原始信息。

const FAILURE_LABELS: Record<FailureCategory, string> = {
  login: "登录失效",
  captcha: "验证码识别",
  video: "视频提交",
  work: "作业异常",
  exam: "考试异常",
  gateway: "网关连接",
  timeout: "请求超时",
  interrupted: "服务中断",
  other: "其它错误",
};

export function classifyFailure(message: string): { category: FailureCategory; label: string } {
  const s = message.toLowerCase();
  let category: FailureCategory = "other";
  if (/超时|timeout|timed out/.test(s)) category = "timeout";
  else if (/验证码|captcha|ocr/.test(s)) category = "captcha";
  else if (/登录|login|密码|会话|登录态|cookie/.test(s)) category = "login";
  else if (/网关|gateway|econnrefused|连接|不可达/.test(s)) category = "gateway";
  else if (/视频|学时|study|提交进度/.test(s)) category = "video";
  else if (/作业|work|homework/.test(s)) category = "work";
  else if (/考试|exam|答题|交卷/.test(s)) category = "exam";
  else if (/重启|中断|abort|停止/.test(s)) category = "interrupted";
  return { category, label: FAILURE_LABELS[category] };
}

interface FailureRow {
  id: string;
  account_uid: string;
  account_name: string | null;
  started_at: string;
  summary_json: string;
}

/** 统计指定天数内任务的错误分类、受影响账号与最近错误明细 */
export function failureBreakdown(days: number): FailureBreakdown {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = sqlite
    .prepare(
      `SELECT j.id, j.account_uid, a.username || CASE WHEN a.remark != '' THEN ' · ' || a.remark ELSE '' END AS account_name,
              j.started_at, j.summary_json
       FROM jobs j LEFT JOIN accounts a ON a.uid = j.account_uid
       WHERE j.started_at >= ? AND j.summary_json IS NOT NULL
       ORDER BY j.started_at DESC`,
    )
    .all(since) as unknown as FailureRow[];

  const reasonMap = new Map<FailureCategory, FailureReason>();
  const jobCategory = new Set<string>();
  const accountMap = new Map<string, { accountUid: string; accountName: string; count: number }>();
  const recent: FailureBreakdown["recent"] = [];
  let total = 0;
  let errorJobs = 0;

  for (const row of rows) {
    let messages: string[];
    try {
      messages = (JSON.parse(row.summary_json) as JobSummary).errors ?? [];
    } catch {
      continue;
    }
    if (!messages.length) continue;
    total += messages.length;
    errorJobs += 1;
    const accountName = row.account_name || row.account_uid.slice(0, 8);
    const account = accountMap.get(row.account_uid) ?? { accountUid: row.account_uid, accountName, count: 0 };
    account.count += messages.length;
    accountMap.set(row.account_uid, account);

    for (const message of messages) {
      const { category, label } = classifyFailure(message);
      const reason = reasonMap.get(category) ?? { category, label, count: 0, jobCount: 0, sample: message };
      reason.count += 1;
      const key = `${row.id}|${category}`;
      if (!jobCategory.has(key)) {
        jobCategory.add(key);
        reason.jobCount += 1;
      }
      reasonMap.set(category, reason);
      if (recent.length < 8) {
        recent.push({
          jobId: row.id,
          accountUid: row.account_uid,
          accountName,
          startedAt: row.started_at,
          category,
          label,
          message,
        });
      }
    }
  }

  return {
    total,
    errorJobs,
    reasons: [...reasonMap.values()].sort((a, b) => b.count - a.count),
    byAccount: [...accountMap.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    recent,
  };
}

/** 删除超出保留期的日志；近 7 天强制保护，与手动删除规则一致 */
export const LOG_AUTO_RETENTION_DAYS = 30;
export function pruneOldLogEvents(retentionDays = LOG_AUTO_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - Math.max(LOG_RETENTION_MS, retentionDays * 86_400_000)).toISOString();
  const info = sqlite
    .prepare(`DELETE FROM job_events WHERE type = 'log' AND created_at < ?`)
    .run(cutoff);
  return Number(info.changes);
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
  /** 全局输出档位（最低级别）：低于该级别的日志不返回 */
  minLevel?: string;
  accountUid?: string;
  jobId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/** 把档位转成可走索引的级别集合条件 */
function minLevelCondition(minLevel?: string): string | null {
  switch (minLevel) {
    case "debug":
      return null;
    case "info":
      return "log_level IN ('info', 'warn', 'error')";
    case "warn":
      return "log_level IN ('warn', 'error')";
    case "error":
      return "log_level = 'error'";
    default:
      return null;
  }
}

/** 日志分页查询：级别/账号/关键字在服务端过滤，按时间倒序返回 */
export function pageLogEvents(filter: LogPageFilter): { items: JobEvent[]; total: number } {
  const conds: string[] = ["type = 'log'"];
  const params: Record<string, string | number> = {};
  const minCond = minLevelCondition(filter.minLevel);
  if (minCond) conds.push(minCond);
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

/** 日志保留保护窗口：近 7 天内的日志强制不可删除（db 层兜底，路由层校验仅为友好提示） */
export const LOG_RETENTION_MS = 7 * 86_400_000;
/** 单次删除时间跨度上限 */
export const LOG_DELETE_SPAN_MS = 366 * 86_400_000;

/**
 * 按时间段删除日志（[from, to)，时间均为 ISO 字符串）。
 * 7 天保护与跨度限制在 db 层强制执行，任何调用路径都无法绕过。
 */
export function deleteLogEvents(from: string, to: string): number {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error("时间格式不正确");
  }
  if (fromMs >= toMs) throw new Error("开始时间必须早于结束时间");
  if (toMs > Date.now() - LOG_RETENTION_MS) {
    throw new Error("近 7 天内的日志不可删除，请把结束时间调整到 7 天以前");
  }
  if (toMs - fromMs > LOG_DELETE_SPAN_MS) {
    throw new Error("单次最多删除 366 天内的日志");
  }
  const info = sqlite
    .prepare(`DELETE FROM job_events WHERE type = 'log' AND created_at >= ? AND created_at < ?`)
    .run(from, to);
  return Number(info.changes);
}
