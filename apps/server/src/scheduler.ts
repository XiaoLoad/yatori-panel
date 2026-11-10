import cron from "node-cron";
import type { JobEvent, ScheduleVO } from "./shared.ts";
import { bus } from "./bus.ts";
import { getAccount, listAccounts } from "./db/accounts.ts";
import { env } from "./env.ts";
import { HttpError } from "./errors.ts";
import {
  clearScheduleJobLinks,
  getSchedule,
  linkScheduleJob,
  listSchedules,
  loadScheduleJobLinks,
  markScheduleRan,
  pruneScheduleJobLinks,
} from "./db/schedules.ts";
import { jobManager } from "./jobs/manager.ts";
import { zonedParts, zonedTodayStartIso, zonedWallTimeToTs } from "./timezone.ts";

/** 候补条目：待补位的账号 + 归属触发批次（补位成功后仍计入该轮的到点停止范围） */
interface Pending {
  uid: string;
  batchId: string;
}

/** 单轮触发统计：收工时输出汇总 */
interface FireStats {
  started: number;
  busy: number;
  disabled: number;
  failed: number;
}

interface Registered {
  start?: ReturnType<typeof cron.schedule>;
  stop?: ReturnType<typeof cron.schedule>;
  /** 本规则在当天启动的任务；到点停止时只作用于这些任务 */
  jobIds: Set<string>;
  /** 本轮触发批次 ID；与 jobIds 一起持久化，重启后可恢复 */
  batchIds: Set<string>;
  /** 候补名单：到点时全局并发名额已满的账号，等任务结束腾出名额后补位启动 */
  queue: Pending[];
  /** 当前轮次统计 */
  stats: FireStats;
  /** 补位进行中标记：任务结束事件与安全网定时器并发时只跑一个补位循环 */
  draining: boolean;
}

const tasks = new Map<string, Registered>();

/** 距结束不足该分钟数时不再补位：为一个只剩几分钟的窗口登录账号没有意义 */
const DRAIN_CUTOFF_MINUTES = 10;

/** 时区内的「今天零点」：按「当天」恢复定时触发的任务，避免跨天误停昨天的任务 */
function localDayStart(): string {
  return zonedTodayStartIso();
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

type StartOutcome = "started" | "busy" | "disabled" | "limit" | "failed";

async function startForAccount(
  s: ScheduleVO,
  accountUid: string,
  jobIds: Set<string>,
  batchId: string,
  triggeredAt: string,
): Promise<StartOutcome> {
  const account = getAccount(accountUid);
  if (!account) {
    log(s, "warn", `定时规则跳过：账号不存在（${accountUid}）`);
    return "failed";
  }
  const label = account.remark || account.username;
  // 与手动发起行为对齐：被禁用的账号不参与定时触发
  if (!account.enabled) {
    log(s, "warn", `定时规则跳过：${label} 已被禁用`, accountUid);
    return "disabled";
  }
  if (jobManager.isAccountBusy(accountUid)) {
    log(s, "warn", `定时规则跳过：${label} 已有运行中的任务`, accountUid);
    return "busy";
  }
  try {
    const job = await jobManager.start(account, {
      accountUid,
      // 指定课程仅"绑定单个账号"的规则可配置（建库与 zod 双重保证）；空数组 = 全部未完成课程
      courseIds: s.courseIds,
      videoMode: s.videoMode,
      answerSource: s.answerSource,
      submitMode: s.submitMode,
      // 与手动发起的默认值一致（StartJobBody.perCourseConcurrency 默认 4）
      perCourseConcurrency: 4,
    });
    jobIds.add(job.id);
    linkScheduleJob(s.id, batchId, job.id, triggeredAt);
    const rangeText = s.courseIds.length > 0 ? `指定的 ${s.courseIds.length} 门课程` : "全部未完成课程";
    log(s, "info", `定时规则触发：${label} 开始刷${rangeText}`, accountUid);
    return "started";
  } catch (err) {
    // 全局并发名额不足：不判失败，交给候补队列在任务结束腾出名额后补位
    if (err instanceof HttpError && err.status === 429) return "limit";
    log(s, "error", `定时任务启动失败：${label} ${(err as Error).message}`, accountUid);
    return "failed";
  }
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
  r.stats = { started: 0, busy: 0, disabled: 0, failed: 0 };
  void (async () => {
    for (const uid of targets) {
      const outcome = await startForAccount(s, uid, r.jobIds, batchId, triggeredAt);
      if (outcome === "started") r.stats.started += 1;
      else if (outcome === "busy") r.stats.busy += 1;
      else if (outcome === "disabled") r.stats.disabled += 1;
      else if (outcome === "failed") r.stats.failed += 1;
      else r.queue.push({ uid, batchId });
    }
    // 仅在真实启动过任务时刷新「上次运行」，全部跳过/失败不视为运行过
    if (r.stats.started > 0) markScheduleRan(s.id);
    if (r.queue.length > 0) {
      log(
        s,
        "info",
        `${r.queue.length} 个账号因并发名额不足进入候补，任务结束后自动补位启动（等待期间不发起任何登录）`,
      );
    }
  })();
}

/** 是否已进入「不再补位」窗口：距离结束时间不足 10 分钟 */
function drainCutoffReached(s: ScheduleVO): boolean {
  if (!s.endTime) return false;
  const [h, m] = s.endTime.split(":").map(Number);
  const today = zonedParts(Date.now());
  const end = zonedWallTimeToTs(today.year, today.month, today.day, h ?? 0, m ?? 0);
  return Date.now() >= end - DRAIN_CUTOFF_MINUTES * 60_000;
}

/**
 * 补位循环：逐个启动候补账号。等待期间零网络请求——只有真的轮到某个账号时才登录；
 * 名额仍满（limit）时立即退出，等下一次任务结束事件或安全网再试。
 * 每轮循环重新读取规则：编辑/禁用后的下一轮即用新配置。
 */
async function drainById(id: string): Promise<void> {
  const r = tasks.get(id);
  if (!r || r.draining || r.queue.length === 0) return;
  r.draining = true;
  let promoted = 0;
  try {
    while (r.queue.length > 0) {
      const s = getSchedule(id);
      if (!s || !s.enabled) {
        r.queue = [];
        return;
      }
      if (drainCutoffReached(s)) {
        const giveUp = r.queue.length;
        r.queue = [];
        log(s, "info", `距结束不足 ${DRAIN_CUTOFF_MINUTES} 分钟，放弃 ${giveUp} 个候补账号`);
        return;
      }
      const next = r.queue[0]!;
      const outcome = await startForAccount(s, next.uid, r.jobIds, next.batchId, new Date().toISOString());
      if (outcome === "limit") return;
      r.queue.shift();
      if (outcome === "started") {
        promoted += 1;
        r.stats.started += 1;
      } else if (outcome === "busy") r.stats.busy += 1;
      else if (outcome === "disabled") r.stats.disabled += 1;
      else if (outcome === "failed") r.stats.failed += 1;
    }
    if (promoted > 0) {
      const s = getSchedule(id);
      if (s) log(s, "info", `候补账号已全部启动：本轮共补位 ${promoted} 个`);
    }
  } finally {
    r.draining = false;
  }
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
  // 本轮收工汇总：候补未跑 = 收工时仍在等待补位的账号
  const pending = r.queue.length;
  if (r.stats.started > 0 || pending > 0 || r.stats.busy > 0 || r.stats.disabled > 0 || r.stats.failed > 0) {
    log(
      s,
      "info",
      `本轮收工汇总：启动 ${r.stats.started} / 占用中跳过 ${r.stats.busy} / 禁用跳过 ${r.stats.disabled} / ` +
        `失败 ${r.stats.failed} / 候补未跑 ${pending}`,
    );
  }
  r.queue = [];
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
  const prev = tasks.get(s.id);
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
  const r: Registered = {
    jobIds,
    batchIds,
    // 编辑/切换启停会重注册：继承未跑完的候补名单，等待中的账号不被静默丢弃
    queue: prev?.queue ?? [],
    stats: prev?.stats ?? { started: 0, busy: 0, disabled: 0, failed: 0 },
    draining: false,
  };
  // 显式指定时区：容器默认 UTC，不传会导致「设 7:30 实际 15:30」
  const tz = { timezone: env.timezone };
  r.start = cron.schedule(s.cron, () => fire(s, r), tz);
  const stopCron = stopCronOf(s);
  r.stop =
    stopCron && cron.validate(stopCron)
      ? cron.schedule(stopCron, () => stopJobs(s, r), tz)
      : undefined;
  tasks.set(s.id, r);
}

export function registerSchedule(schedule: ScheduleVO): void {
  registerById(schedule);
}

export function unregisterSchedule(id: string): void {
  unregisterById(id);
}

/** 任务结束事件：任一任务收尾都可能腾出全局名额，逐规则尝试补位 */
function watchJobSettled(): void {
  bus.subscribe({}, (e: JobEvent) => {
    if (e.type !== "job.status") return;
    if (e.state !== "done" && e.state !== "stopped" && e.state !== "error") return;
    for (const id of tasks.keys()) void drainById(id);
  });
}

export function startScheduler(): void {
  pruneScheduleJobLinks();
  for (const s of listSchedules()) registerById(s);
  watchJobSettled();
  // 安全网：任务结束事件理论覆盖所有补位时机，定时兜底防漏接；空转时仅查 Map，开销可忽略
  const timer = setInterval(() => {
    for (const id of tasks.keys()) void drainById(id);
  }, 60_000);
  timer.unref();
}
