import type { ScheduleRepeat, ScheduleScope, ScheduleVO, StopMode, SubmitMode } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface ScheduleRow {
  id: string;
  name: string;
  account_uid: string;
  account_uids: string;
  scope: string;
  course_ids: string;
  cron: string;
  repeat_mode: string;
  run_date: string | null;
  end_time: string | null;
  stop_mode: string;
  video_mode: number;
  answer_source: string;
  auto_submit: number;
  submit_mode: string;
  enabled: number;
  last_run_at: string | null;
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

function toVO(r: ScheduleRow): ScheduleVO {
  return {
    id: r.id,
    name: r.name || "",
    scope: (r.scope as ScheduleScope) === "all" ? "all" : "accounts",
    accountUids: parseUids(r.account_uids),
    courseIds: parseUids(r.course_ids),
    cron: r.cron,
    repeatMode: r.repeat_mode === "once" ? "once" : "weekly",
    runDate: r.run_date,
    endTime: r.end_time,
    stopMode: (r.stop_mode as StopMode) || "finish_current",
    videoMode: r.video_mode as ScheduleVO["videoMode"],
    answerSource: r.answer_source as ScheduleVO["answerSource"],
    submitMode: (r.submit_mode as SubmitMode) || "off",
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
  };
}

export function listSchedules(): ScheduleVO[] {
  const rows = sqlite
    .prepare(`SELECT * FROM schedules ORDER BY created_at DESC`)
    .all() as unknown as ScheduleRow[];
  return rows.map(toVO);
}

interface ScheduleConfig {
  name: string;
  scope?: ScheduleScope;
  accountUids: string[];
  /** 指定课程 ID；仅"绑定单个账号"的规则可非空，空/缺省 = 全部课程 */
  courseIds?: string[];
  cron: string;
  /** 触发方式：weekly 按星期重复 / once 指定日期执行一次 */
  repeatMode?: ScheduleRepeat;
  /** 一次性执行日期 YYYY-MM-DD；weekly 模式忽略 */
  runDate?: string | null;
  endTime?: string;
  stopMode: StopMode;
  videoMode: ScheduleVO["videoMode"];
  answerSource: ScheduleVO["answerSource"];
  submitMode: SubmitMode;
}

function configParams(id: string, input: ScheduleConfig): Record<string, string | number | null> {
  const scope = input.scope === "all" ? "all" : "accounts";
  // 全部账号作用域不持有名单；指定账号作用域下旧列保留首个账号，保持历史数据与旧查询兼容
  const uids = scope === "all" ? [] : input.accountUids;
  // 指定课程仅对「绑定单个账号」的规则有效——前端与 zod 同样拦截，这里兜底防脏数据落库
  const courseIds = scope === "accounts" && uids.length === 1 ? (input.courseIds ?? []) : [];
  return {
    id,
    name: input.name,
    scope,
    account_uid: uids[0] ?? "",
    account_uids: JSON.stringify(uids),
    course_ids: JSON.stringify(courseIds),
    cron: input.cron,
    repeat_mode: input.repeatMode === "once" ? "once" : "weekly",
    // 一次性规则的日期只在 once 模式保留，避免切回每周后残留脏值
    run_date: input.repeatMode === "once" ? (input.runDate || null) : null,
    end_time: input.endTime || null,
    stop_mode: input.stopMode,
    video_mode: input.videoMode,
    answer_source: input.answerSource,
    auto_submit: input.submitMode === "direct" ? 1 : 0,
    submit_mode: input.submitMode,
  };
}

export function insertSchedule(input: ScheduleConfig): ScheduleVO {
  const row = { ...configParams(newId(), input), enabled: 1, last_run_at: null, created_at: now() };
  sqlite
    .prepare(
      `INSERT INTO schedules (id, name, scope, account_uid, account_uids, course_ids, cron, repeat_mode, run_date, end_time, stop_mode, video_mode, answer_source, auto_submit, submit_mode, enabled, last_run_at, created_at)
       VALUES (@id, @name, @scope, @account_uid, @account_uids, @course_ids, @cron, @repeat_mode, @run_date, @end_time, @stop_mode, @video_mode, @answer_source, @auto_submit, @submit_mode, @enabled, @last_run_at, @created_at)`,
    )
    .run(row);
  return toVO(row as unknown as ScheduleRow);
}

export function deleteSchedule(id: string): void {
  sqlite.prepare(`DELETE FROM schedule_job_links WHERE schedule_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
}

/**
 * 编辑规则：仅更新可配置字段，保留 enabled / last_run_at / created_at。
 * 调用方负责在更新后重新注册调度（registerSchedule 的安全重注册会接管当天批次）。
 */
export function updateSchedule(id: string, input: ScheduleConfig): ScheduleVO | null {
  const info = sqlite
    .prepare(
      `UPDATE schedules SET name = @name, scope = @scope, account_uid = @account_uid, account_uids = @account_uids,
       course_ids = @course_ids, cron = @cron, repeat_mode = @repeat_mode, run_date = @run_date,
       end_time = @end_time, stop_mode = @stop_mode, video_mode = @video_mode,
       answer_source = @answer_source, auto_submit = @auto_submit, submit_mode = @submit_mode
       WHERE id = @id`,
    )
    .run(configParams(id, input));
  return Number(info.changes) > 0 ? getSchedule(id) : null;
}

export function setScheduleEnabled(id: string, enabled: boolean): void {
  sqlite.prepare(`UPDATE schedules SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

export function markScheduleRan(id: string): void {
  sqlite.prepare(`UPDATE schedules SET last_run_at = ? WHERE id = ?`).run(now(), id);
}

export function getSchedule(id: string): ScheduleVO | null {
  const row = sqlite.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as
    | ScheduleRow
    | undefined;
  return row ? toVO(row) : null;
}

// ---------- 定时触发批次：把「本轮启动了哪些任务」落库 ----------
// 进程内 Set 会在重启或规则重新注册时丢失，导致到点停止失效。
// 每轮触发分配一个 batchId，逐账号成功后写入关联；重新注册时按当天批次恢复。

export function linkScheduleJob(
  scheduleId: string,
  batchId: string,
  jobId: string,
  triggeredAt: string,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO schedule_job_links (schedule_id, batch_id, job_id, triggered_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(scheduleId, batchId, jobId, triggeredAt);
}

/** 恢复指定时间点之后由该规则启动的任务（用于重启/重新注册后继续接管停止） */
export function loadScheduleJobLinks(
  scheduleId: string,
  since: string,
): { jobId: string; batchId: string }[] {
  const rows = sqlite
    .prepare(
      `SELECT job_id, batch_id FROM schedule_job_links
       WHERE schedule_id = ? AND triggered_at >= ? ORDER BY triggered_at DESC, job_id`,
    )
    .all(scheduleId, since) as { job_id: string; batch_id: string }[];
  return rows.map((r) => ({ jobId: r.job_id, batchId: r.batch_id }));
}

/** 清理过期的定时触发关联：无结束时间的规则不会自动调用 clearScheduleJobLinks */
export function pruneScheduleJobLinks(retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const info = sqlite
    .prepare(`DELETE FROM schedule_job_links WHERE triggered_at < ?`)
    .run(cutoff);
  return Number(info.changes);
}

/** 到点停止完成后清理本轮批次，避免关联表无限增长；传 batchId 时只清该轮 */
export function clearScheduleJobLinks(scheduleId: string, batchId?: string): void {
  if (batchId) {
    sqlite
      .prepare(`DELETE FROM schedule_job_links WHERE schedule_id = ? AND batch_id = ?`)
      .run(scheduleId, batchId);
  } else {
    sqlite.prepare(`DELETE FROM schedule_job_links WHERE schedule_id = ?`).run(scheduleId);
  }
}

/**
 * 删除账号时从「指定账号」规则的名单中摘除该 uid；规则不再被静默删除——
 * 名单为空时规则保留，由触发时跳过、列表页展示「作用域为空」警示。
 * 「全部账号」作用域现场解析账号，无需处理。
 * 返回发生变化的规则，供调用方重新注册调度。
 */
export function removeAccountFromSchedules(uid: string): ScheduleVO[] {
  const rows = sqlite.prepare(`SELECT * FROM schedules`).all() as unknown as ScheduleRow[];
  const changed: ScheduleVO[] = [];
  for (const r of rows) {
    if (r.scope === "all") continue;
    const uids = parseUids(r.account_uids);
    if (!uids.includes(uid)) continue;
    const rest = uids.filter((x) => x !== uid);
    sqlite
      .prepare(`UPDATE schedules SET account_uids = ?, account_uid = ? WHERE id = ?`)
      .run(JSON.stringify(rest), rest[0] ?? "", r.id);
    changed.push(toVO({ ...r, account_uids: JSON.stringify(rest) }));
  }
  return changed;
}
