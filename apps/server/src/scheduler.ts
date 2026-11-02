import cron from "node-cron";
import type { ScheduleVO } from "./shared.ts";
import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { listSchedules, markScheduleRan } from "./db/schedules.ts";
import { jobManager } from "./jobs/manager.ts";

interface Registered {
  start: ReturnType<typeof cron.schedule>;
  stop?: ReturnType<typeof cron.schedule>;
  /** 本规则在当天启动的任务，到点停止时只作用于这些任务 */
  jobIds: Set<string>;
}

const tasks = new Map<string, Registered>();

/** 结束时间沿用开始 cron 的日/月/周字段，保证只在同一天收尾 */
function stopCronOf(s: ScheduleVO): string | null {
  if (!s.endTime) return null;
  const [hour, minute] = s.endTime.split(":").map(Number);
  const parts = s.cron.trim().split(/\s+/);
  if (parts.length !== 5) return `${minute} ${hour} * * *`;
  return `${minute} ${hour} ${parts[2]} ${parts[3]} ${parts[4]}`;
}

function log(s: ScheduleVO, level: "info" | "warn" | "error", message: string, accountId?: string): void {
  bus.publish({ type: "log", ts: Date.now(), accountId, level, message });
}

async function startForAccount(s: ScheduleVO, accountUid: string, jobIds: Set<string>): Promise<void> {
  const account = getAccount(accountUid);
  if (!account) {
    log(s, "warn", `定时规则跳过：账号不存在（${accountUid}）`);
    return;
  }
  const label = account.remark || account.username;
  if (jobManager.isAccountBusy(accountUid)) {
    log(s, "warn", `定时规则跳过：${label} 已有运行中的任务`, accountUid);
    return;
  }
  try {
    const job = await jobManager.start(account, {
      accountUid,
      courseIds: [],
      videoMode: s.videoMode,
      answerSource: s.answerSource,
      submitMode: s.submitMode,
      perCourseConcurrency: 4,
    });
    jobIds.add(job.id);
    log(s, "info", `定时规则触发：${label} 开始刷全部未完成课程`, accountUid);
  } catch (err) {
    log(s, "error", `定时任务启动失败：${label} ${(err as Error).message}`, accountUid);
  }
}

function fire(s: ScheduleVO, jobIds: Set<string>): void {
  void (async () => {
    for (const uid of s.accountUids) {
      await startForAccount(s, uid, jobIds);
    }
    markScheduleRan(s.id);
  })();
}

function stopJobs(s: ScheduleVO, jobIds: Set<string>): void {
  const graceful = s.stopMode === "finish_current";
  let count = 0;
  for (const id of jobIds) {
    if (jobManager.isRunning(id) && jobManager.stop(id, graceful)) count += 1;
  }
  if (count > 0) {
    log(
      s,
      "info",
      graceful
        ? `定时停止：${count} 个任务将在当前节点结束后停止`
        : `定时停止：${count} 个任务已立即停止`,
    );
  }
}

function unregisterById(id: string): void {
  const r = tasks.get(id);
  r?.start.stop();
  r?.stop?.stop();
  tasks.delete(id);
}

function registerById(s: ScheduleVO): void {
  unregisterById(s.id);
  if (!s.enabled) return;
  const jobIds = new Set<string>();
  const start = cron.schedule(s.cron, () => fire(s, jobIds));
  const stopCron = stopCronOf(s);
  const stop =
    stopCron && cron.validate(stopCron)
      ? cron.schedule(stopCron, () => stopJobs(s, jobIds))
      : undefined;
  tasks.set(s.id, { start, stop, jobIds });
}

export function registerSchedule(schedule: ScheduleVO): void {
  registerById(schedule);
}

export function unregisterSchedule(id: string): void {
  unregisterById(id);
}

/** 启动时加载全部启用的定时任务 */
export function startScheduler(): void {
  for (const s of listSchedules()) registerById(s);
}
