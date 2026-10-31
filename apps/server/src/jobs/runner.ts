import type { GatewayCourse, GatewayNode } from "../gateway.ts";
import { gateway } from "../gateway.ts";
import { bus } from "../bus.ts";
import { appendJobEvent } from "../db/jobs.ts";
import { upsertNode } from "../db/nodes.ts";
import { getSettings } from "../db/settings.ts";
import type { JobSummary, StartJobBody } from "../shared.ts";

/** 英华"标红"（并行播放检测）的响应文案 */
const RED_MESSAGES = ["检测到可能使用并行播放刷课", "检测到并行播放刷课"];
/** 解锁时间未到：跳过该节点 */
const UNLOCK_RE = /解锁时间【[^】]*】未到/;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function emptySummary(): JobSummary {
  return {
    courses: 0,
    videosCompleted: 0,
    videosSkipped: 0,
    flagsFound: 0,
    worksDone: 0,
    examsDone: 0,
    errors: [],
  };
}

/**
 * 任务运行器：把"普通/暴力/去红"三模式调度策略落在 tick 循环上。
 * 参考 console 的 logic/yinghua 逻辑重构：课程串行，节点按模式串行/并发，
 * 每 tickSeconds 秒提交一次学时（SDK 的 Study 是单次提交原语）。
 */
export async function runJob(
  jobId: string,
  accountUid: string,
  sid: string,
  options: StartJobBody,
  signal: AbortSignal,
): Promise<JobSummary> {
  const settings = getSettings();
  const tickMs = settings.tickSeconds * 1000;
  const summary = emptySummary();

  const emit = (e: Omit<import("../shared.ts").JobEvent, "ts">) => {
    const full = { ...e, ts: Date.now() } as import("../shared.ts").JobEvent;
    if (e.type === "task.flag") appendJobEvent(jobId, full);
    bus.publish(full);
  };

  const checkAbort = (): boolean => {
    if (signal.aborted) {
      summary.errors.push("任务被手动停止");
      return true;
    }
    return false;
  };

  // ---------- 单节点刷课循环 ----------
  async function studyVideo(course: GatewayCourse, node: GatewayNode): Promise<void> {
    const total =
      node.durationSeconds || Number(node.extra?.["duration"] ?? 0);
    let position = Number(node.extra?.["viewedSeconds"] ?? 0);
    let flagged = false;
    let retries = 0;

    // start：让适配器从平台记录的续播位置开始
    try {
      await gateway.study(sid, {
        courseId: course.id,
        nodeId: node.id,
        action: "start",
      });
    } catch {
      /* start 失败不致命，progress 会带上 position */
    }

    for (;;) {
      if (checkAbort()) return;
      position += settings.tickSeconds;
      if (total > 0 && position > total) position = total;

      let res;
      try {
        res = await gateway.study(sid, {
          courseId: course.id,
          nodeId: node.id,
          action: "progress",
          positionSeconds: position,
        });
      } catch (err) {
        retries += 1;
        if (retries >= 3) {
          summary.errors.push(
            `${course.name}/${node.name}: ${(err as Error).message}`,
          );
          return;
        }
        await sleep(10_000, signal);
        continue;
      }
      retries = 0;

      const msg = res.message ?? "";
      const rawText =
        typeof res.raw === "string" ? res.raw : JSON.stringify(res.raw ?? "");

      // 标红检测（响应文案）
      const redHit = RED_MESSAGES.some((p) => msg.includes(p) || rawText.includes(p));
      if (redHit && !flagged) {
        flagged = true;
        summary.flagsFound += 1;
        emit({
          type: "task.flag",
          jobId,
          accountId: accountUid,
          courseId: course.id,
          courseName: course.name,
          nodeId: node.id,
          nodeName: node.name,
          reason: "检测到并行播放刷课标记（建议切去红模式重跑）",
        });
      }

      // 解锁时间未到 → 跳过
      if (UNLOCK_RE.test(msg)) {
        summary.videosSkipped += 1;
        upsertNode(accountUid, course.id, node, res.progress, false, flagged);
        emit({
          type: "task.progress",
          jobId,
          accountId: accountUid,
          courseId: course.id,
          courseName: course.name,
          nodeId: node.id,
          nodeName: node.name,
          progress: res.progress,
          watchedSeconds: res.positionSeconds ?? position,
          totalSeconds: total,
        });
        return;
      }

      upsertNode(accountUid, course.id, node, res.progress, res.completed, flagged);
      emit({
        type: "task.progress",
        jobId,
        accountId: accountUid,
        courseId: course.id,
        courseName: course.name,
        nodeId: node.id,
        nodeName: node.name,
        progress: res.progress,
        watchedSeconds: res.positionSeconds ?? position,
        totalSeconds: total,
      });

      if (res.completed || (total > 0 && position >= total)) {
        summary.videosCompleted += 1;
        return;
      }
      await sleep(tickMs, signal);
    }
  }

  // ---------- 作业 / 考试 ----------
  async function runWorks(course: GatewayCourse): Promise<void> {
    if (options.answerSource === "off") return;
    let works;
    try {
      works = await gateway.works(sid, course.id);
    } catch (err) {
      summary.errors.push(`作业列表拉取失败 ${course.name}: ${(err as Error).message}`);
      return;
    }
    for (const w of works) {
      if (checkAbort()) return;
      try {
        await gateway.doWork(sid, {
          courseId: course.id,
          workId: w.id,
          source: options.answerSource,
          submit: options.autoSubmit,
        });
        summary.worksDone += 1;
        emit({
          type: "log",
          jobId,
          accountId: accountUid,
          level: "info",
          message: `作业完成：${course.name} / ${w.name}`,
        });
      } catch (err) {
        summary.errors.push(`作业 ${course.name}/${w.name}: ${(err as Error).message}`);
      }
    }
  }

  async function runExams(course: GatewayCourse): Promise<void> {
    if (options.answerSource === "off") return;
    let exams;
    try {
      exams = await gateway.exams(sid, course.id);
    } catch (err) {
      summary.errors.push(`考试列表拉取失败 ${course.name}: ${(err as Error).message}`);
      return;
    }
    for (const x of exams) {
      if (checkAbort()) return;
      try {
        await gateway.doExam(sid, {
          courseId: course.id,
          examId: x.id,
          source: options.answerSource,
          submit: options.autoSubmit,
        });
        summary.examsDone += 1;
        emit({
          type: "log",
          jobId,
          accountId: accountUid,
          level: "info",
          message: `考试完成：${course.name} / ${x.name}`,
        });
      } catch (err) {
        summary.errors.push(`考试 ${course.name}/${x.name}: ${(err as Error).message}`);
      }
    }
  }

  // ---------- 课程级调度 ----------
  function collectVideoLeaves(tree: GatewayNode[]): GatewayNode[] {
    const out: GatewayNode[] = [];
    const walk = (ns: GatewayNode[]) => {
      for (const n of ns) {
        if (n.children && n.children.length > 0) walk(n.children);
        else if ((n.extra?.["tabVideo"] ?? "false") === "true" || n.kind === "video")
          out.push(n);
      }
    };
    walk(tree);
    return out;
  }

  async function runPool(
    items: GatewayNode[],
    limit: number,
    fn: (n: GatewayNode) => Promise<void>,
  ): Promise<void> {
    let idx = 0;
    const workers = Array.from(
      { length: Math.min(Math.max(1, limit), items.length) },
      async () => {
        for (;;) {
          if (signal.aborted || idx >= items.length) return;
          const item = items[idx++];
          await fn(item);
        }
      },
    );
    await Promise.all(workers);
  }

  async function runCourse(course: GatewayCourse): Promise<void> {
    const tree = await gateway.tree(sid, course.id);
    const videos = collectVideoLeaves(tree).filter((v) => !v.completed);

    // 普通模式(1)：节点串行；暴力模式(2)：节点并发；去红模式(3)：未完成节点串行重跑
    if (options.videoMode === 2) {
      await runPool(videos, options.perCourseConcurrency, (n) => studyVideo(course, n));
    } else {
      for (const n of videos) {
        if (checkAbort()) return;
        await studyVideo(course, n);
      }
    }
  }

  // ---------- 主流程 ----------
  let courses: GatewayCourse[] = [];
  try {
    courses = await gateway.courses(sid);
  } catch (err) {
    throw new Error(`课程列表拉取失败：${(err as Error).message}`);
  }
  if (options.courseIds.length > 0) {
    courses = courses.filter((c) => options.courseIds.includes(c.id));
  }
  if (courses.length === 0) {
    throw new Error("没有可运行的课程（检查勾选范围或账号下是否有课程）");
  }
  summary.courses = courses.length;

  for (const course of courses) {
    if (checkAbort()) return summary;
    try {
      await runCourse(course);
      await runWorks(course);
      await runExams(course);
    } catch (err) {
      summary.errors.push(`课程 ${course.name}: ${(err as Error).message}`);
    }
  }
  return summary;
}
