import cron from "node-cron";
import type { ScheduleVO } from "./shared.ts";
import { bus } from "./bus.ts";
import { getAccount, listAccounts } from "./db/accounts.ts";
import {
  clearScheduleJobLinks,
  linkScheduleJob,
  listSchedules,
  loadScheduleJobLinks,
  markScheduleRan,
  pruneScheduleJobLinks,
} from "./db/schedules.ts";
import { jobManager } from "./jobs/manager.ts";

interface Registered {
  start?: ReturnType<typeof cron.schedule>;
  stop?: ReturnType<typeof cron.schedule>;
  /** 本规则在当天启动的任务；到点停止时只作用于这些任务 */
  jobIds: Set<string>;
  /** 本轮触发批次 ID；与 jobIds 一起持久化，重启后可恢复 */
  batchIds: Set<string>;
}

const tasks = new Map<string, Registered>();

/** 本地零点：按「当天」恢复定时触发的任务，避免跨天误停昨天的任务 */
function localDayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

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

async function startForAccount(
  s: ScheduleVO,
  accountUid: string,
  jobIds: Set<string>,
  batchId: string,
  triggeredAt: string,
): Promise<void> {
  const account = getAccount(accountUid);
  if (!account) {
    log(s, "warn", `定时规则跳过：账号不存在（${accountUid}）`);
    return;
  }
  const label = account.remark || account.username;
  // 与手动发起行为对齐：被禁用的账号不参与定时触发
  if (!account.enabled) {
    log(s, "warn", `定时规则跳过：${label} 已被禁用`, accountUid);
    return;
  }
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
    linkScheduleJob(s.id, batchId, job.id, triggeredAt);
    log(s, "info", `定时规则触发：${label} 开始刷全部未完成课程`, accountUid);
  } catch (err) {
    log(s, "error", `定时任务启动失败：${label} ${(err as Error).message}`, accountUid);
  }
}

/**
 * 触发时解析规则作用的目标账号：
 * - all：现场取「当时全部启用账号」——规则建好后新增/删除账号无需修改规则；
 * - accounts：固定名单（存在性/禁用/占用在启动时逐个校验）。
 */
function resolveTargets(s: ScheduleVO): string[] {
  if (s.scope === "all") {
    return listAccounts()
      .filter((a) => a.enabled)
      .map((a) => a.uid);
  }
  return s.accountUids;
}

function fire(s: ScheduleVO, r: Registered): void {
  const targets = resolveTargets(s);
  if (targets.length === 0) {
    log(s, "warn", "定时规则跳过：作用域为空（指定账号名单已空，或没有启用中的账号）");
    return;
  }
  const batchId = `${s.id}-${Date.now()}`;
  const triggeredAt = new Date().toISOString();
  r.batchIds.add(batchId);
  void (async () => {
    for (const uid of targets) {
      await startForAccount(s, uid, r.jobIds, batchId, triggeredAt);
    }
    markScheduleRan(s.id);
  })();
}

function stopJobs(s: ScheduleVO, r: Registered): void {
  const graceful = s.stopMode === "finish_current";
  let count = 0;
  for (const id of r.jobIds) {
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
  // 停止指令已发出，清理当天批次；重启后不再重复接管已收尾任务
  for (const batchId of r.batchIds) clearScheduleJobLinks(s.id, batchId);
  r.batchIds.clear();
  r.jobIds.clear();
}

function unregisterById(id: string): void {
  const r = tasks.get(id);
  r?.start?.stop();
  r?.stop?.stop();
  tasks.delete(id);
}

function registerById(s: ScheduleVO): void {
  unregisterById(s.id);
  if (!s.enabled) return;
  const jobIds = new Set<string>();
  const batchIds = new Set<string>();
  // 服务重启或规则重新注册：从数据库恢复当天由本规则启动且仍在运行的任务，
  // 避免「到点停止」因为内存 Set 丢失而失效。
  const restored = loadScheduleJobLinks(s.id, localDayStart());
  for (const link of restored) {
    if (!jobManager.isRunning(link.jobId)) continue;
    jobIds.add(link.jobId);
    batchIds.add(link.batchId);
  }
  const r: Registered = { jobIds, batchIds };
  r.start = cron.schedule(s.cron, () => fire(s, r));
  const stopCron = stopCronOf(s);
  r.stop =
    stopCron && cron.validate(stopCron)
      ? cron.schedule(stopCron, () => stopJobs(s, r))
      : undefined;
  tasks.set(s.id, r);
}

export function registerSchedule(schedule: ScheduleVO): void {
  registerById(schedule);
}

export function unregisterSchedule(id: string): void {
  unregisterById(id);
}

/** 启动时加载全部启用的定时任务，并清理过期的触发关联 */
export function startScheduler(): void {
  pruneScheduleJobLinks();
  for (const s of listSchedules()) registerById(s);
}
