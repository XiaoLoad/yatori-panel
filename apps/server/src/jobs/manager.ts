import type { AccountVO, JobSummary, StartJobBody } from "../shared.ts";
import { bus } from "../bus.ts";
import { finishJob, insertJob } from "../db/jobs.ts";
import { HttpError } from "../errors.ts";
import { ensureSession } from "../sessions.ts";
import { runJob } from "./runner.ts";

interface RunningJob {
  ctrl: AbortController;
  accountUid: string;
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
    const sid = await ensureSession(account);

    const job = insertJob(options);
    const ctrl = new AbortController();
    this.running.set(job.id, { ctrl, accountUid: account.uid });

    bus.publish({
      type: "job.status",
      ts: Date.now(),
      jobId: job.id,
      accountId: account.uid,
      state: "running",
    });

    void runJob(job.id, account.uid, sid, options, ctrl.signal)
      .then((summary: JobSummary) => {
        const state = ctrl.signal.aborted ? "stopped" : "done";
        finishJob(job.id, state, summary);
        bus.publish({
          type: "job.status",
          ts: Date.now(),
          jobId: job.id,
          accountId: account.uid,
          state,
          summary,
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
          errors: [String((err as Error)?.message ?? err)],
        };
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

  stop(jobId: string): boolean {
    const r = this.running.get(jobId);
    if (!r) return false;
    r.ctrl.abort();
    return true;
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
