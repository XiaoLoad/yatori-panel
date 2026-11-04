import type { FastifyInstance } from "fastify";
import { BatchStartJobBody, DeleteLogsBody, StartJobBody, type BatchStartResult } from "../shared.ts";
import { bus } from "../bus.ts";
import { getAccount } from "../db/accounts.ts";
import { deleteLogEvents, eventsForJob, finishJob, getJob, listJobs, pageJobs, pageLogEvents, recentLogEvents } from "../db/jobs.ts";
import { HttpError } from "../errors.ts";
import { jobManager } from "../jobs/manager.ts";
import { assertAnswerSourceReady } from "./guards.ts";
import { pageParams, parse } from "./shared.ts";

/** 任务：发起、批量、停止/暂停、任务与日志查询 */
export function registerJobRoutes(app: FastifyInstance): void {
  app.post("/api/v1/jobs", async (req) => {
    const body = parse<StartJobBody>(req.body, StartJobBody);
    const account = getAccount(body.accountUid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (!account.enabled) throw new HttpError(400, "账号已被禁用");

    await assertAnswerSourceReady(body.answerSource);

    const job = await jobManager.start(account, body);
    return { ok: true, data: job };
  });

  // 批量发起：多账号同时启动，逐账号返回成功/失败，不因单个失败中断整批
  app.post("/api/v1/jobs/batch", async (req) => {
    const body = parse<BatchStartJobBody>(req.body, BatchStartJobBody);
    await assertAnswerSourceReady(body.answerSource);

    const result: BatchStartResult = { started: [], failed: [] };
    for (const item of body.accounts) {
      const account = getAccount(item.accountUid);
      if (!account) {
        result.failed.push({ accountUid: item.accountUid, error: "账号不存在" });
        continue;
      }
      if (!account.enabled) {
        result.failed.push({ accountUid: item.accountUid, error: "账号已被禁用" });
        continue;
      }
      try {
        const job = await jobManager.start(account, {
          accountUid: item.accountUid,
          courseIds: item.courseIds ?? [],
          videoMode: body.videoMode,
          answerSource: body.answerSource,
          submitMode: body.submitMode,
          perCourseConcurrency: body.perCourseConcurrency,
        });
        result.started.push({ accountUid: item.accountUid, jobId: job.id });
      } catch (err) {
        result.failed.push({ accountUid: item.accountUid, error: (err as Error).message });
      }
    }
    return { ok: true, data: result };
  });

  app.post("/api/v1/jobs/:id/stop", async (req) => {
    const { id } = req.params as { id: string };
    const graceful = Boolean((req.body as { graceful?: boolean } | undefined)?.graceful);
    if (!jobManager.stop(id, graceful)) {
      const job = getJob(id);
      if (!job) throw new HttpError(404, "任务不存在");
      // 运行器已不存在但 DB 仍是 running（进程重启/异常残留）：直接收尾，避免前端一直显示运行中
      if (job.state === "running") {
        const summary = job.summary ?? {
          courses: 0,
          videosCompleted: 0,
          videosSkipped: 0,
          flagsFound: 0,
          worksDone: 0,
          examsDone: 0,
          scores: [],
          errors: [],
        };
        const finishedSummary = {
          ...summary,
          errors: [...summary.errors, "任务不在运行器中，已自动标记为停止"],
        };
        finishJob(id, "stopped", finishedSummary);
        bus.publish({
          type: "job.status",
          ts: Date.now(),
          jobId: id,
          accountId: job.accountUid,
          state: "stopped",
          summary: finishedSummary,
        });
        return { ok: true, data: { stopped: true } };
      }
      return { ok: true, data: { stopped: false, reason: "任务已结束" } };
    }
    return { ok: true, data: { stopped: true } };
  });

  app.get("/api/v1/jobs", async (req) => {
    const q = req.query as { accountUid?: string; state?: string; limit?: string };
    const data = listJobs({
      accountUid: q.accountUid,
      state: q.state,
      limit: q.limit ? Number(q.limit) : undefined,
    }).map((j) => ({ ...j, paused: jobManager.isPaused(j.id) }));
    return { ok: true, data };
  });

  // 台账分页：筛选与分页都在服务端完成，避免前端只过滤当前页
  app.get("/api/v1/jobs/history", async (req) => {
    const q = req.query as {
      accountUid?: string;
      state?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };
    const { page, pageSize } = pageParams(q, 20, 100);
    const { items, total } = pageJobs({
      accountUid: q.accountUid || undefined,
      state: q.state || undefined,
      search: q.search?.trim() || undefined,
      page,
      pageSize,
    });
    return {
      ok: true,
      data: {
        items: items.map((j) => ({ ...j, paused: jobManager.isPaused(j.id) })),
        total,
        page,
        pageSize,
      },
    };
  });

  app.get("/api/v1/jobs/:id", async (req) => {
    const job = getJob((req.params as { id: string }).id);
    if (!job) throw new HttpError(404, "任务不存在");
    return { ok: true, data: { ...job, paused: jobManager.isPaused(job.id), events: eventsForJob(job.id) } };
  });

  // 暂停/继续：任务保留在运行器中，tick 边界挂起或恢复
  app.post("/api/v1/jobs/:id/pause", async (req) => {
    const { id } = req.params as { id: string };
    if (!jobManager.pause(id)) throw new HttpError(409, "任务不在运行中，无法暂停");
    return { ok: true, data: { paused: true } };
  });

  app.post("/api/v1/jobs/:id/resume", async (req) => {
    const { id } = req.params as { id: string };
    if (!jobManager.resume(id)) throw new HttpError(409, "任务不在运行中，无法继续");
    return { ok: true, data: { paused: false } };
  });

  // 全站日志（来自 job_events 持久化），供观测台在刷新后回填历史
  app.get("/api/v1/logs", async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(800, Math.max(50, Number(q.limit) || 300));
    return { ok: true, data: recentLogEvents(limit) };
  });

  // 日志分页检索：级别、账号、关键字过滤
  app.get("/api/v1/logs/history", async (req) => {
    const q = req.query as {
      level?: string;
      accountUid?: string;
      jobId?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };
    const { page, pageSize } = pageParams(q, 50, 200);
    const { items, total } = pageLogEvents({
      level: q.level || undefined,
      accountUid: q.accountUid || undefined,
      jobId: q.jobId || undefined,
      search: q.search?.trim() || undefined,
      page,
      pageSize,
    });
    return { ok: true, data: { items, total, page, pageSize } };
  });

  // 按时间段删除日志：结束时间必须早于 7 天前，防止误删近期日志
  const LOG_RETENTION_MS = 7 * 86_400_000;
  app.delete("/api/v1/logs", async (req) => {
    const body = parse<DeleteLogsBody>(req.body, DeleteLogsBody);
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new HttpError(400, "时间格式不正确");
    }
    if (from.getTime() >= to.getTime()) throw new HttpError(400, "开始时间必须早于结束时间");
    const cutoff = Date.now() - LOG_RETENTION_MS;
    if (to.getTime() > cutoff) {
      throw new HttpError(400, "近 7 天内的日志不可删除，请把结束时间调整到 7 天以前");
    }
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new HttpError(400, "单次最多删除 366 天内的日志");
    }
    const deleted = deleteLogEvents(from.toISOString(), to.toISOString());
    return { ok: true, data: { deleted } };
  });
}
