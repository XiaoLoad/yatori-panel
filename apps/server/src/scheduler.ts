import cron from "node-cron";
import type { ScheduleVO } from "./shared.ts";
import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { listSchedules, markScheduleRan } from "./db/schedules.ts";
import { jobManager } from "./jobs/manager.ts";

const tasks = new Map<string, ReturnType<typeof cron.schedule>>();

function fire(schedule: ScheduleVO): void {
  const account = getAccount(schedule.accountUid);
  if (!account) return;
  if (jobManager.isAccountBusy(schedule.accountUid)) {
    bus.publish({
      type: "log",
      ts: Date.now(),
      accountId: schedule.accountUid,
      level: "warn",
      message: `定时触发跳过：账号已有运行中的任务（${schedule.cron}）`,
    });
    return;
  }
  markScheduleRan(schedule.id);
  bus.publish({
    type: "log",
    ts: Date.now(),
    accountId: schedule.accountUid,
    level: "info",
    message: `定时任务触发（${schedule.cron}）：开始刷全部未完成课程`,
  });
  void jobManager
    .start(account, {
      accountUid: schedule.accountUid,
      courseIds: [],
      videoMode: schedule.videoMode,
      answerSource: schedule.answerSource,
      autoSubmit: schedule.autoSubmit,
      perCourseConcurrency: 4,
    })
    .catch((err: unknown) => {
      bus.publish({
        type: "log",
        ts: Date.now(),
        accountId: schedule.accountUid,
        level: "error",
        message: `定时任务启动失败：${(err as Error).message}`,
      });
    });
}

function registerById(schedule: ScheduleVO): void {
  unregisterById(schedule.id);
  if (!schedule.enabled) return;
  const task = cron.schedule(schedule.cron, () => fire(schedule));
  tasks.set(schedule.id, task);
}

function unregisterById(id: string): void {
  tasks.get(id)?.stop();
  tasks.delete(id);
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
