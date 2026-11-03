import type { AccountVO, JobSummary, StartJobBody } from "../shared.ts";
import { bus } from "../bus.ts";
import { finishJob, insertJob } from "../db/jobs.ts";
import { HttpError } from "../errors.ts";
import { sendCompletionMail } from "../mailer.ts";
import { ensureSession } from "../sessions.ts";
import { runJob } from "./runner.ts";

function summaryHtml(state: string, summary: JobSummary): string {
  const errors = summary.errors.length
    ? `<p>错误：${summary.errors.map((e) => `• ${e}`).join("<br/>")}</p>`
    : "";
  return `<p>状态：${state}</p><p>课程 ${summary.courses} 门 · 完成视频 ${summary.videosCompleted} · 跳过 ${summary.videosSkipped} · 标红 ${summary.flagsFound}</p><p>作业 ${summary.worksDone} · 考试 ${summary.examsDone}</p>${errors}`;
}

async function notifyCompletion(
  account: AccountVO,
  state: string,
  summary: JobSummary,
): Promise<void> {
  if (state === "stopped") return; // 手动停止不打扰
  await sendCompletionMail({
    accountName: account.remark || account.username,
    state,
    summaryHtml: summaryHtml(state, summary),
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

    // 先确保会话可用（登录失败会带 OCR 日志抛给前端）
    await ensureSession(account);

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
        void notifyCompletion(account, state, summary).catch((err) => {
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
