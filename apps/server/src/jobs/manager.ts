import type { AccountVO, JobEvent, JobSummary, StartJobBody } from "../shared.ts";
import { siteTagsFor } from "../shared.ts";
import { bus } from "../bus.ts";
import { listAccounts } from "../db/accounts.ts";
import { appendJobEvent, finishJob, insertJob } from "../db/jobs.ts";
import { getSettings } from "../db/settings.ts";
import { HttpError } from "../errors.ts";
import { sendCompletionMail } from "../mailer.ts";
import { resolveNotifyDecision } from "./notify-policy.ts";
import { ensureSession } from "../sessions.ts";
import { runJob } from "./runner.ts";

/** 同学号多站点的账号在邮件中追加站点标签，两份报告可区分 */
function siteTagOfAccount(uid: string): string {
  return siteTagsFor(listAccounts()).get(uid) ?? "";
}

async function notifyCompletion(
  jobId: string,
  account: AccountVO,
  state: string,
  summary: JobSummary,
  startedAt: string,
): Promise<void> {
  const decision = resolveNotifyDecision(state, summary);
  if (decision.state === "skipped") {
    // 手动停止已在运行器里提示过，这里只解释「完成但无产出」为何没有邮件
    if (state !== "stopped") {
      const label = account.remark || account.username;
      const event: JobEvent = {
        type: "log",
        ts: Date.now(),
        jobId,
        accountId: account.uid,
        level: "info",
        message: `[${label}] 邮件通知已跳过：${decision.reason}`,
      };
      appendJobEvent(jobId, event);
      bus.publish(event);
    }
    return;
  }
  await sendCompletionMail({
    account: { username: account.username, remark: account.remark, siteTag: siteTagOfAccount(account.uid) },
    state,
    summary,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
}

interface RunningJob {
  ctrl: AbortController;
  accountUid: string;
  /** 到点停止：置位后在节点边界收尾，不中断当前视频 */
  graceful: boolean;
  /** 暂停：置位后运行器在 tick 边界等待，不提交进度也不结束任务 */
  paused: boolean;
}

/**
 * 任务管理器：任务的入口/出口（DB 状态机 + AbortController + 事件发布）。
 * 同一账号同时只允许一个任务（与 console 的实例锁语义一致）。
 */
class JobManager {
  private running = new Map<string, RunningJob>();
  /** 正在登录/建会话、尚未写入 running 的任务数，防止并发 start 绕过全局限流 */
  private startingCount = 0;

  async start(
    account: AccountVO & { password: string },
    options: StartJobBody,
  ): Promise<ReturnType<typeof insertJob>> {
    const existing = [...this.running.values()].find(
      (r) => r.accountUid === account.uid,
    );
    if (existing) {
      throw new HttpError(409, "该账号已有运行中的任务，请先停止");
    }

    // 全局账号并发上限：批量发起与定时触发都经由 start，统一在入口限流。
    // 以在内存运行器中的任务数为准，避免重启后 DB 残留 running 行误占名额。
    const limit = Math.max(1, Math.min(10, getSettings().maxAccountsConcurrency));
    if (this.running.size + this.startingCount >= limit) {
      throw new HttpError(429, `当前已有 ${this.running.size + this.startingCount} 个账号任务运行，达到全局并发上限 ${limit}`);
    }

    // 先确保会话可用（登录失败会带 OCR 日志抛给前端）
    this.startingCount += 1;
    try {
      await ensureSession(account);
    } finally {
      this.startingCount -= 1;
    }
    // 登录等待期间可能有其它任务占满名额，落库前再校验一次
    if (this.running.size >= limit) {
      throw new HttpError(429, `当前已有 ${this.running.size} 个账号任务运行，达到全局并发上限 ${limit}`);
    }

    const job = insertJob(options);
    const ctrl = new AbortController();
    const runningJob: RunningJob = { ctrl, accountUid: account.uid, graceful: false, paused: false };
    this.running.set(job.id, runningJob);

    bus.publish({
      type: "job.status",
      ts: Date.now(),
      jobId: job.id,
      accountId: account.uid,
      state: "running",
    });

    void runJob(job.id, account.uid, options, ctrl.signal, () => runningJob.graceful, () => runningJob.paused)
      .then((summary: JobSummary) => {
        const state = ctrl.signal.aborted || runningJob.graceful ? "stopped" : "done";
        finishJob(job.id, state, summary);
        bus.publish({
          type: "job.status",
          ts: Date.now(),
          jobId: job.id,
          accountId: account.uid,
          state,
          summary,
        });
        void notifyCompletion(job.id, account, state, summary, job.startedAt).catch((err) => {
          bus.publish({
            type: "log",
            ts: Date.now(),
            jobId: job.id,
            accountId: account.uid,
            level: "error",
            message: `邮件通知发送失败：${(err as Error).message}`,
          });
        });
      })
      .catch((err: unknown) => {
        const summary: JobSummary = {
          courses: 0,
          videosCompleted: 0,
          videosSkipped: 0,
          flagsFound: 0,
          worksDone: 0,
          examsDone: 0,
          scores: [],
          errors: [String((err as Error)?.message ?? err)],
        };
        // 停止触发的中断（abort 打断请求/会话重建）按 stopped 收尾，不算错误
        if (ctrl.signal.aborted) {
          finishJob(job.id, "stopped", summary);
          bus.publish({
            type: "job.status",
            ts: Date.now(),
            jobId: job.id,
            accountId: account.uid,
            state: "stopped",
            summary,
          });
          return;
        }
        finishJob(job.id, "error", summary);
        bus.publish({
          type: "job.status",
          ts: Date.now(),
          jobId: job.id,
          accountId: account.uid,
          state: "error",
          message: String((err as Error)?.message ?? err),
          summary,
        });
        void notifyCompletion(job.id, account, "error", summary, job.startedAt).catch((err) => {
          bus.publish({
            type: "log",
            ts: Date.now(),
            jobId: job.id,
            accountId: account.uid,
            level: "error",
            message: `邮件通知发送失败：${(err as Error).message}`,
          });
        });
      })
      .finally(() => {
        this.running.delete(job.id);
      });

    return job;
  }

  /** graceful=true 时只置停止标记，由运行器在节点边界收尾 */
  stop(jobId: string, graceful = false): boolean {
    const r = this.running.get(jobId);
    if (!r) return false;
    if (graceful) r.graceful = true;
    else r.ctrl.abort();
    return true;
  }

  /** 暂停：任务保留在运行器中，运行器在 tick 边界等待继续 */
  pause(jobId: string): boolean {
    const r = this.running.get(jobId);
    if (!r) return false;
    r.paused = true;
    return true;
  }

  resume(jobId: string): boolean {
    const r = this.running.get(jobId);
    if (!r) return false;
    r.paused = false;
    return true;
  }

  isPaused(jobId: string): boolean {
    return this.running.get(jobId)?.paused ?? false;
  }

  isAccountBusy(accountUid: string): boolean {
    return [...this.running.values()].some((r) => r.accountUid === accountUid);
  }

  stopByAccount(accountUid: string): boolean {
    let stopped = false;
    for (const r of this.running.values()) {
      if (r.accountUid === accountUid) {
        r.ctrl.abort();
        stopped = true;
      }
    }
    return stopped;
  }

  stopAll(): void {
    for (const r of this.running.values()) r.ctrl.abort();
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }
}

export const jobManager = new JobManager();
