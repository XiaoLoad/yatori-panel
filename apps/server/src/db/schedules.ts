import type { ScheduleVO, StopMode, SubmitMode } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface ScheduleRow {
  id: string;
  name: string;
  account_uid: string;
  account_uids: string;
  cron: string;
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
    accountUids: parseUids(r.account_uids),
    cron: r.cron,
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

export function insertSchedule(input: {
  name: string;
  accountUids: string[];
  cron: string;
  endTime?: string;
  stopMode: StopMode;
  videoMode: ScheduleVO["videoMode"];
  answerSource: ScheduleVO["answerSource"];
  submitMode: SubmitMode;
}): ScheduleVO {
  const row: ScheduleRow = {
    id: newId(),
    name: input.name,
    // 旧列保留首个账号，保持历史数据与旧查询兼容
    account_uid: input.accountUids[0] ?? "",
    account_uids: JSON.stringify(input.accountUids),
    cron: input.cron,
    end_time: input.endTime || null,
    stop_mode: input.stopMode,
    video_mode: input.videoMode,
    answer_source: input.answerSource,
    auto_submit: input.submitMode === "direct" ? 1 : 0,
    submit_mode: input.submitMode,
    enabled: 1,
    last_run_at: null,
    created_at: now(),
  };
  sqlite
    .prepare(
      `INSERT INTO schedules (id, name, account_uid, account_uids, cron, end_time, stop_mode, video_mode, answer_source, auto_submit, submit_mode, enabled, last_run_at, created_at)
       VALUES (@id, @name, @account_uid, @account_uids, @cron, @end_time, @stop_mode, @video_mode, @answer_source, @auto_submit, @submit_mode, @enabled, @last_run_at, @created_at)`,
    )
    .run(row);
  return toVO(row);
}

export function deleteSchedule(id: string): void {
  sqlite.prepare(`DELETE FROM schedule_job_links WHERE schedule_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
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

/** 删除账号时把 uid 从所有定时规则中摘除；无剩余账号的规则直接删除 */
export function removeAccountFromSchedules(uid: string): {
  deletedIds: string[];
  changed: ScheduleVO[];
} {
  const rows = sqlite.prepare(`SELECT * FROM schedules`).all() as unknown as ScheduleRow[];
  const deletedIds: string[] = [];
  const changed: ScheduleVO[] = [];
  for (const r of rows) {
    const uids = parseUids(r.account_uids);
    if (!uids.includes(uid)) continue;
    const rest = uids.filter((x) => x !== uid);
    if (rest.length === 0) {
      sqlite.prepare(`DELETE FROM schedule_job_links WHERE schedule_id = ?`).run(r.id);
      sqlite.prepare(`DELETE FROM schedules WHERE id = ?`).run(r.id);
      deletedIds.push(r.id);
    } else {
      sqlite
        .prepare(`UPDATE schedules SET account_uids = ?, account_uid = ? WHERE id = ?`)
        .run(JSON.stringify(rest), rest[0] ?? "", r.id);
      changed.push(toVO({ ...r, account_uids: JSON.stringify(rest) }));
    }
  }
  return { deletedIds, changed };
}
