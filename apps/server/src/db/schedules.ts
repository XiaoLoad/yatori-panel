import type { ScheduleVO } from "../shared.ts";
import { newId, now, sqlite } from "./index.ts";

interface ScheduleRow {
  id: string;
  account_uid: string;
  cron: string;
  video_mode: number;
  answer_source: string;
  auto_submit: number;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
  [k: string]: string | number | null;
}

function toVO(r: ScheduleRow): ScheduleVO {
  return {
    id: r.id,
    accountUid: r.account_uid,
    cron: r.cron,
    videoMode: r.video_mode as ScheduleVO["videoMode"],
    answerSource: r.answer_source as ScheduleVO["answerSource"],
    autoSubmit: r.auto_submit === 1,
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

export function getSchedulesFor(accountUid: string): ScheduleVO[] {
  return listSchedules().filter((s) => s.accountUid === accountUid);
}

export function insertSchedule(input: {
  accountUid: string;
  cron: string;
  videoMode: ScheduleVO["videoMode"];
  answerSource: ScheduleVO["answerSource"];
  autoSubmit: boolean;
}): ScheduleVO {
  const row: ScheduleRow = {
    id: newId(),
    account_uid: input.accountUid,
    cron: input.cron,
    video_mode: input.videoMode,
    answer_source: input.answerSource,
    auto_submit: input.autoSubmit ? 1 : 0,
    enabled: 1,
    last_run_at: null,
    created_at: now(),
  };
  sqlite
    .prepare(
      `INSERT INTO schedules (id, account_uid, cron, video_mode, answer_source, auto_submit, enabled, last_run_at, created_at)
       VALUES (@id, @account_uid, @cron, @video_mode, @answer_source, @auto_submit, @enabled, @last_run_at, @created_at)`,
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
