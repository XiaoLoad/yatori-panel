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
