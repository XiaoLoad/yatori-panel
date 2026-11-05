import type {
  GatewayCourse,
  GatewayExam,
  GatewayNode,
  GatewayWork,
} from "../gateway.ts";
import { gateway } from "../gateway.ts";
import { bus } from "../bus.ts";
import { appendJobEvent, saveJobProgress } from "../db/jobs.ts";
import { clearNodeFlag, flaggedNodeIds, upsertNode } from "../db/nodes.ts";
import { getSettings } from "../db/settings.ts";
import { getAccount } from "../db/accounts.ts";
import { rebuildSession } from "../sessions.ts";
import { ensureSessionForUid } from "../sessions.ts";
import type { JobSummary, StartJobBody } from "../shared.ts";
import { examWindowState } from "./exam-window.ts";

/** 英华"标红"（并行播放检测）的响应文案 */
const RED_MESSAGES = ["检测到可能使用并行播放刷课", "检测到并行播放刷课"];
/** 解锁时间未到：跳过该节点 */
const UNLOCK_RE = /解锁时间【[^】]*】未到/;
/** 登录超时：需要重建会话后重试 */
const RELOGIN_RE = /账号登录超时/;
/** 网关侧会话丢失（重建会话后，其他并发课程可能撞到旧 sid） */
const SESSION_LOST_RE = /session not (?:found|online)/i;

/** 去红：最多几轮、单节点最多几次、成功/失败后的间隔（对齐 console 的 8s/10s 节奏） */
const RED_ROUND_LIMIT = 3;
const RED_ATTEMPT_LIMIT = 5;
const RED_OK_INTERVAL_MS = 8_000;
const RED_FAIL_INTERVAL_MS = 10_000;

/** 模式名：日志与界面文案保持同一口径 */
const MODE_LABELS: Record<number, string> = {
  1: "普通（课程内视频逐个刷）",
  2: "暴力（课程内视频并发刷，结束后自动去红）",
  3: "去红（只清理被平台标记的节点）",
};

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

/** 任务停止触发的中断错误：manager 捕获后按 stopped 收尾而非 error */
class JobAborted extends Error {
  constructor() {
    super("任务已停止");
  }
}

/**
 * 让不感知 signal 的长等待（会话创建/重建）可被任务停止打断：
 * signal 触发立即 reject，底层 promise 继续跑但结果被丢弃。
 */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new JobAborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new JobAborted());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function isSessionLost(err: unknown): boolean {
  return SESSION_LOST_RE.test((err as Error)?.message ?? "");
}

/** 考试时间展示：MM-DD HH:mm；平台未给或非法时显示"时间未定" */
function formatExamTime(iso: string | null | undefined): string {
  if (!iso) return "时间未定";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "时间未定";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function emptySummary(): JobSummary {
  return {
    courses: 0,
    videosCompleted: 0,
    videosSkipped: 0,
    flagsFound: 0,
    worksDone: 0,
    examsDone: 0,
    scores: [],
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
  options: StartJobBody,
  signal: AbortSignal,
  /** 到点停止：true 时在节点/作业/考试边界收尾，当前节点允许看完 */
  shouldStop?: () => boolean,
  /** 暂停：true 时在 tick 边界等待继续，不提交进度也不结束任务 */
  shouldPause?: () => boolean,
): Promise<JobSummary> {
  const settings = getSettings();
  const tickMs = settings.tickSeconds * 1000;
  const summary = emptySummary();
  // 本次任务覆盖的课程与已加载章节树，用于整体进度与剩余时长估算
  let courses: GatewayCourse[] = [];
  const nodesByCourse = new Map<string, GatewayNode[]>();
  const doneCourses = new Set<string>();
  /** 每门课最近活跃节点，用于并行课程时区分各自在刷什么 */
  const currentByCourse = new Map<string, string>();
  // 本次任务中被标记的节点（去红目标），以及已处理过的作业/考试（避免多轮重复提交）
  const flagSet = new Set<string>();
  const doneWorks = new Set<string>();
  const doneExams = new Set<string>();
  // 账号标识（优先备注）：日志前缀，多账号并发时区分日志归属
  const account = getAccount(accountUid);
  const accountLabel = account ? (account.remark || account.username) : accountUid;
  // sid 用可变持有：登录超时自愈时会整会话重建
  let sid = await abortable(ensureSessionForUid(accountUid), signal);
  let rebuilds = 0;
  const MAX_REBUILDS = 5;

  const emit = (e: Omit<import("../shared.ts").JobEvent, "ts">) => {
    const full = { ...e, ts: Date.now() } as import("../shared.ts").JobEvent;
    if (e.type === "task.flag" || e.type === "log") appendJobEvent(jobId, full);
    // 进度快照落库：页面刷新/重连后仍能显示阶段与课程整体进度
    if (e.type === "task.progress") saveJobProgress(jobId, full);
    bus.publish(full);
  };

  // 里程碑日志：进 SSE 日志面板，也落库供任务详情回放。
  // persist=false 的高频调试行（如逐次学时提交）只走实时流，不写库。
  const emitLog = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    persist = true,
  ) => {
    const full = { type: "log", jobId, accountId: accountUid, level, message: `[${accountLabel}] ${message}`, ts: Date.now() } as import("../shared.ts").JobEvent;
    if (persist) appendJobEvent(jobId, full);
    bus.publish(full);
  };

  const checkAbort = (): boolean => signal.aborted;
  // 到点停止（graceful）只在节点/作业/考试边界生效，避免半截断连丢进度
  const stopRequested = (): boolean => signal.aborted || (shouldStop?.() ?? false);

  /** 暂停闸门：在当前进度提交间隙等待，继续后从原位置接着刷 */
  async function waitIfPaused(): Promise<void> {
    if (!shouldPause?.()) return;
    emitLog("info", "任务已暂停，等待继续", false);
    while (shouldPause?.() && !signal.aborted) {
      try {
        await sleep(500, signal);
      } catch {
        return;
      }
    }
    if (!signal.aborted) emitLog("info", "任务已继续", false);
  }

  /**
   * 任务整体进度：按已加载章节树的视频时长汇总。
   * 只统计已获取到树的课程，估算值随课程启动逐步精确；ETA 按课程并发折算。
   */
  function jobOverview() {
    const coursesProgress = courses.map((course) => {
      const nodes = nodesByCourse.get(course.id);
      let total = 0;
      let remaining = 0;
      if (nodes) {
        for (const n of nodes) {
          // 只统计叶子视频节点：章节节点也带 duration，重复累加会把预计时长放大
          const isVideo = n.kind === "video" || (n.extra?.["tabVideo"] ?? "false") === "true";
          if (!isVideo || (n.children && n.children.length > 0)) continue;
          const duration = n.durationSeconds || Number(n.extra?.["duration"] ?? 0);
          if (!duration) continue;
          const viewed = Number(n.extra?.["viewedSeconds"] ?? 0);
          const progressPct = n.completed
            ? 100
            : Math.max(
                Math.min(100, Math.max(0, Number(n.progress) || 0)),
                duration > 0 ? Math.min(100, (viewed / duration) * 100) : 0,
              );
          total += duration;
          remaining += duration * (1 - progressPct / 100);
        }
      }
      const completed = doneCourses.has(course.id);
      const progress = total > 0 ? Math.round(((total - remaining) / total) * 100) : completed ? 100 : 0;
      return {
        courseId: course.id,
        courseName: course.name,
        totalSeconds: Math.round(total),
        remainingSeconds: Math.round(remaining),
        progress: Math.min(100, Math.max(0, progress)),
        completed,
        loaded: !!nodes,
        currentNodeName: currentByCourse.get(course.id),
      };
    });

    const courseTotalSeconds = coursesProgress.reduce((s, c) => s + c.totalSeconds, 0);
    const courseRemainingSeconds = coursesProgress.reduce((s, c) => s + c.remainingSeconds, 0);
    const courseCount = coursesProgress.length;
    const coursesRemaining = coursesProgress.filter((c) => !c.completed).length;
    // 只剩一门课有剩余时按 1 门并发估算，避免多门课已完成后 ETA 被继续摊薄
    const activeLeft = coursesProgress.filter((c) => !c.completed && c.remainingSeconds > 0).length;
    const activeCourses = Math.max(1, Math.min(settings.maxCoursesConcurrency, activeLeft || 1));
    return {
      courseTotalSeconds,
      courseRemainingSeconds,
      courseCount,
      coursesRemaining,
      etaSeconds: Math.round(courseRemainingSeconds / activeCourses),
      coursesProgress,
    };
  }

  /**
   * 会话失效兜底：重建会话后其他并发课程仍可能短暂使用旧 sid，
   * 撞到 "session not found" 时重建一次并重试（重建本身按账号单飞）。
   */
  async function withSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
    try {
      return await fn(sid);
    } catch (err) {
      if (!isSessionLost(err)) throw err;
      emitLog("warn", "网关会话已失效，正在重建会话…");
      sid = await abortable(rebuildSession(accountUid), signal);
      return fn(sid);
    }
  }

  // ---------- 单节点刷课循环 ----------
  async function studyVideo(
    course: GatewayCourse,
    node: GatewayNode,
  ): Promise<void | "blocked"> {
    const total =
      node.durationSeconds || Number(node.extra?.["duration"] ?? 0);
    let position = Number(node.extra?.["viewedSeconds"] ?? 0);
    let flagged = false;
    let retries = 0;

    emitLog(
      "info",
      `开始学习视频：${course.name} / ${node.name}（已看 ${position}s / 总长 ${total || "?"}s）`,
    );

    // start：让适配器从平台记录的续播位置开始
    try {
      await withSession((s) =>
        gateway.study(
          s,
          {
            courseId: course.id,
            nodeId: node.id,
            action: "start",
          },
          { signal },
        ),
      );
    } catch {
      /* start 失败不致命，progress 会带上 position */
    }

    for (;;) {
      if (checkAbort()) return;
      await waitIfPaused();
      if (checkAbort()) return;
      position += settings.tickSeconds;
      if (total > 0 && position > total) position = total;

      let res;
      try {
        res = await withSession((s) =>
          gateway.study(
            s,
            {
              courseId: course.id,
              nodeId: node.id,
              action: "progress",
              positionSeconds: position,
              durationSeconds: total,
            },
            { signal },
          ),
        );
      } catch (err) {
        retries += 1;
        if (retries >= 3) {
          const m = `视频提交连续失败：${course.name}/${node.name} — ${(err as Error).message}`;
          summary.errors.push(m);
          emitLog("error", m);
          return;
        }
        await sleep(10_000, signal);
        continue;
      }
      retries = 0;

      const msg = res.message ?? "";
      const rawText =
        typeof res.raw === "string" ? res.raw : JSON.stringify(res.raw ?? "");

      // 登录超时 → 重建会话自愈（本次 tick 未成功提交，回退位置后重试）
      if (RELOGIN_RE.test(msg) || rawText.includes("账号登录超时")) {
        rebuilds += 1;
        if (rebuilds > MAX_REBUILDS) {
          const m = `登录超时且会话重建达上限：${course.name}/${node.name}`;
          summary.errors.push(m);
          emitLog("error", m);
          return;
        }
        emitLog("warn", `检测到登录超时，正在重建会话（第 ${rebuilds} 次）…`);
        position -= settings.tickSeconds;
        sid = await abortable(rebuildSession(accountUid), signal);
        emitLog("info", "会话已重建，继续当前视频");
        continue;
      }

      // 只有平台明确返回「提交学时成功」才算真实进度；
      // 适配器结果里的 progress 是本地回显，对被拒绝的提交不代表平台状态
      const accepted = msg.includes("提交学时成功");

      if (!accepted) {
        // 解锁时间未到 → 跳过该节点
        if (UNLOCK_RE.test(msg)) {
          summary.videosSkipped += 1;
          upsertNode(accountUid, course.id, node, 0, false, flagged);
          emitLog("warn", `跳过未解锁视频：${course.name} / ${node.name}（未到解锁时间）`);
          return;
        }
        // 前置顺序锁 → 该课程后续节点整链被挡，跳过整门课
        if (rawText.includes("请先学完上一个视频")) {
          summary.videosSkipped += 1;
          emitLog(
            "warn",
            `前置视频未完成：${course.name} / ${node.name}——该课程剩余节点已锁，跳过`,
          );
          return "blocked";
        }
        // 未知拒绝：重试（上限 3 次）
        retries += 1;
        if (retries >= 3) {
          const m = `提交被平台拒绝：${course.name}/${node.name} — ${(msg || rawText || "无响应文案").slice(0, 60)}`;
          summary.errors.push(m);
          emitLog("error", m);
          return;
        }
        emitLog("warn", `提交未确认（${(msg || "无文案").slice(0, 40)}），10 秒后重试`);
        position -= settings.tickSeconds;
        await sleep(10_000, signal);
        continue;
      }

      retries = 0;

      // 标红检测（响应文案）
      const redHit = RED_MESSAGES.some((p) => msg.includes(p) || rawText.includes(p));
      if (redHit && !flagged) {
        flagged = true;
        flagSet.add(node.id);
        summary.flagsFound += 1;
        emitLog("warn", `标红：${course.name} / ${node.name}（并行播放检测，已记录该节点）`);
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

      upsertNode(accountUid, course.id, node, res.progress, res.completed, flagged);
      // 同步内存中的节点状态，供任务整体进度实时汇总
      node.progress = res.completed ? 100 : res.progress;
      node.completed = res.completed;
      currentByCourse.set(course.id, node.name);

      // 逐次提交只发 DEBUG 且不落库：日志页切到 DEBUG 级别可观察每次学时提交
      emitLog(
        "debug",
        `提交学时：${course.name} / ${node.name} → ${Math.round(res.progress)}%（${
          res.positionSeconds ?? position
        }s / ${total || "?"}s）`,
        false,
      );
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
        ...jobOverview(),
      });

      // 对齐 console：最后一次提交后也睡一个 tick 再进入下一视频，
      // 保证相邻视频之间有真实间隔（先睡后判断，否则间隔为零）
      await sleep(tickMs, signal);
      if (res.completed || (total > 0 && position >= total)) {
        summary.videosCompleted += 1;
        emitLog("info", `视频学习完成：${course.name} / ${node.name}`);
        return;
      }
    }
  }

  // ---------- 作业 / 考试（按节点触发，对齐 console） ----------

  /**
   * 智能交卷：先全部保存（submit=false），检查返回的逐题答案有无留空，
   * 全部作答才二次调用交卷。对齐 console 的 ExamAutoSubmit==2 档。
   */
  async function smartSubmit(
    label: string,
    id: string,
    kind: "work" | "exam",
    courseId: string,
  ): Promise<Awaited<ReturnType<typeof gateway.doWork>>> {
    const saved = await doAnswer(kind, courseId, id, false);
    const answers = saved.answers ?? [];
    const blank = answers.filter((a) => !a.value || a.value.length === 0).length;
    if (blank > 0) {
      emitLog("warn", `${label}：${blank} 题未答上（留空），仅保存不交卷`);
      return saved;
    }
    return doAnswer(kind, courseId, id, true);
  }

  /** 按交卷策略执行一次作业/考试调用；返回作答结果（submitted 字段在 smart 两段式下由外层判断） */
  function doAnswer(
    kind: "work" | "exam",
    courseId: string,
    id: string,
    submit: boolean,
  ): Promise<Awaited<ReturnType<typeof gateway.doWork>>> {
    if (kind === "work") {
      return withSession((s) =>
        gateway.doWork(
          s,
          {
            courseId,
            workId: id,
            source: options.answerSource,
            submit,
          },
          { signal },
        ),
      );
    }
    return withSession((s) =>
      gateway.doExam(
        s,
        {
          courseId,
          examId: id,
          source: options.answerSource,
          submit,
        },
        { signal },
      ),
    );
  }

  interface NodeTasks {
    works: GatewayWork[];
    exams: GatewayExam[];
  }

  /**
   * 课程内作业/考试按节点归组（nodeId → 任务）。
   * console 是在「节点循环里」逐个节点触发作业/考试，而不是整门课结束后统一处理；
   * 这里保持同样的时机，只是把列表一次性拉回来按节点分发。
   */
  async function loadNodeTasks(
    course: GatewayCourse,
  ): Promise<Map<string, NodeTasks>> {
    const map = new Map<string, NodeTasks>();
    if (options.answerSource === "off") return map;

    const entryFor = (nodeId: string): NodeTasks => {
      let entry = map.get(nodeId);
      if (!entry) {
        entry = { works: [], exams: [] };
        map.set(nodeId, entry);
      }
      return entry;
    };

    let works: GatewayWork[] = [];
    try {
      works = await withSession((s) => gateway.works(s, course.id, { signal }));
    } catch (err) {
      const m = `作业列表拉取失败 ${course.name}: ${(err as Error).message}`;
      summary.errors.push(m);
      emitLog("error", m);
    }
    let exams: GatewayExam[] = [];
    try {
      exams = await withSession((s) => gateway.exams(s, course.id, { signal }));
    } catch (err) {
      const m = `考试列表拉取失败 ${course.name}: ${(err as Error).message}`;
      summary.errors.push(m);
      emitLog("error", m);
    }

    // 未到开始时间/已结束的考试不进待办：时间平台本就随列表下发（RFC3339），
    // 此前每晚盲试只会收到平台拒绝并计入失败看板；跳过记 info，
    // 「到点自动接上」不受影响——过了开始时间后下一轮自然纳入。
    const now = new Date();
    const deferred: string[] = [];
    const expired: string[] = [];
    exams = exams.filter((x) => {
      const w = examWindowState(x.startAt, x.endAt, now);
      if (w === "not_started") {
        deferred.push(`${course.name}/${x.name}（${formatExamTime(x.startAt)} 开考）`);
        return false;
      }
      if (w === "ended") {
        expired.push(`${course.name}/${x.name}`);
        return false;
      }
      return true;
    });
    if (deferred.length > 0) emitLog("info", `跳过未到考试时间的考试：${deferred.join("、")}`);
    if (expired.length > 0) emitLog("info", `跳过已结束的考试：${expired.join("、")}`);

    // 已参加过的考试跳过：英华只读查分（不进考试流程、不消耗做题次数）；
    // 查询失败降级为现行行为（照常尝试，由平台裁决），检查失败不能挡住考试。
    if (exams.length > 0 && account?.platform === "YINGHUA") {
      try {
        const takenIds = new Set<string>();
        for (let i = 0; i < exams.length; i += 30) {
          const chunk = exams.slice(i, i + 30); // 网关单次最多查询 30 场
          const results = await withSession((s) =>
            gateway.examResults(
              s,
              {
                courseId: course.id,
                exams: chunk.map((x) => ({ examId: x.id, nodeId: x.extra?.["nodeId"] ?? "" })),
              },
              { signal },
            ),
          );
          for (const r of results) if (r.taken) takenIds.add(r.examId);
        }
        if (takenIds.size > 0) {
          const names = exams.filter((x) => takenIds.has(x.id)).map((x) => `${course.name}/${x.name}`);
          exams = exams.filter((x) => !takenIds.has(x.id));
          emitLog("info", `跳过已参加过的考试：${names.join("、")}`);
        }
      } catch (err) {
        emitLog("warn", `考试状态查询失败，按未考过继续：${(err as Error).message}`);
      }
    }

    for (const w of works) {
      const nodeId = w.extra?.["nodeId"];
      if (nodeId) entryFor(nodeId).works.push(w);
    }
    for (const x of exams) {
      const nodeId = x.extra?.["nodeId"];
      if (nodeId) entryFor(nodeId).exams.push(x);
    }
    return map;
  }

  async function answerWork(course: GatewayCourse, w: GatewayWork): Promise<void> {
    try {
      let submitted: boolean;
      let r: Awaited<ReturnType<typeof gateway.doWork>>;
      if (options.submitMode === "smart") {
        r = await smartSubmit(`作业 ${course.name}/${w.name}`, w.id, "work", course.id);
        submitted = r.submitted;
      } else {
        r = await doAnswer("work", course.id, w.id, options.submitMode === "direct");
        submitted = r.submitted;
      }
      summary.worksDone += 1;
      if (submitted && r.score > 0) {
        const s = `${w.name} ${r.score}分`;
        summary.scores.push(s);
        emitLog("info", `作业完成：${course.name} / ${w.name}（得分 ${r.score}）`);
      } else if (submitted) {
        emitLog("warn", `作业已提交但未确认得分，请到平台核实：${course.name} / ${w.name}`);
      } else {
        emitLog("info", `作业已答题，未提交：${course.name} / ${w.name}`);
      }
    } catch (err) {
      const m = `作业 ${course.name}/${w.name}: ${(err as Error).message}`;
      summary.errors.push(m);
      emitLog("error", m);
    } finally {
      doneWorks.add(w.id);
    }
  }

  async function answerExam(course: GatewayCourse, x: GatewayExam): Promise<void> {
    try {
      let submitted: boolean;
      let r: Awaited<ReturnType<typeof gateway.doExam>>;
      if (options.submitMode === "smart") {
        r = await smartSubmit(`考试 ${course.name}/${x.name}`, x.id, "exam", course.id);
        submitted = r.submitted;
      } else {
        r = await doAnswer("exam", course.id, x.id, options.submitMode === "direct");
        submitted = r.submitted;
      }
      summary.examsDone += 1;
      if (submitted && r.score > 0) {
        const s = `${x.name} ${r.score}分`;
        summary.scores.push(s);
        emitLog("info", `考试完成：${course.name} / ${x.name}（得分 ${r.score}）`);
      } else if (submitted) {
        emitLog("warn", `考试已提交但未确认得分，请到平台核实：${course.name} / ${x.name}`);
      } else {
        emitLog("info", `考试已答题，未提交：${course.name} / ${x.name}`);
      }
    } catch (err) {
      const m = `考试 ${course.name}/${x.name}: ${(err as Error).message}`;
      summary.errors.push(m);
      emitLog("error", m);
    } finally {
      doneExams.add(x.id);
    }
  }

  /** 处理某个节点上的作业/考试（同一次任务内同一份作业/考试只处理一次） */
  async function runNodeTasks(
    course: GatewayCourse,
    node: GatewayNode,
    tasks: Map<string, NodeTasks>,
  ): Promise<void> {
    const entry = tasks.get(node.id);
    if (!entry) return;
    await waitIfPaused();
    currentByCourse.set(course.id, node.name);
    if (entry.works.length > 0) {
      emit({ type: "task.progress", phase: "work", courseId: course.id, courseName: course.name, ...jobOverview() });
      emitLog("info", `节点 ${node.name}：发现 ${entry.works.length} 份作业，开始答题`);
    }
    for (const w of entry.works) {
      if (stopRequested()) return;
      if (doneWorks.has(w.id)) continue;
      await answerWork(course, w);
    }
    if (entry.exams.length > 0) {
      emit({ type: "task.progress", phase: "exam", courseId: course.id, courseName: course.name, ...jobOverview() });
      emitLog("info", `节点 ${node.name}：发现 ${entry.exams.length} 场考试，开始答题`);
    }
    for (const x of entry.exams) {
      if (stopRequested()) return;
      if (doneExams.has(x.id)) continue;
      await answerExam(course, x);
    }
  }

  // ---------- 节点 / 课程调度 ----------
  /** 拍平章节树：作业/考试挂在任意节点上，按 console 的做法逐节点处理 */
  function flattenNodes(tree: GatewayNode[]): GatewayNode[] {
    const out: GatewayNode[] = [];
    const walk = (ns: GatewayNode[]) => {
      for (const n of ns) {
        out.push(n);
        if (n.children && n.children.length > 0) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }

  function isVideoNode(n: GatewayNode): boolean {
    const tabVideo = (n.extra?.["tabVideo"] ?? "false") === "true";
    return !n.completed && (tabVideo || n.kind === "video");
  }

  /** 通用并发池：课程并发与节点并发共用，按 stopRequested 在任务间收尾 */
  async function runPool<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let idx = 0;
    const workers = Array.from(
      { length: Math.min(Math.max(1, limit), items.length) },
      async () => {
        for (;;) {
          if (stopRequested() || idx >= items.length) return;
          const item = items[idx++];
          await fn(item);
        }
      },
    );
    await Promise.all(workers);
  }

  /**
   * 去红单节点（对齐 console videoBadRedAction）：
   * 用节点当前已看时长原样提交（不递增），成功一次即可；
   * 成功间隔 8 秒，失败间隔 10 秒；最多 RED_ATTEMPT_LIMIT 次。
   */
  async function cleanRedNode(course: GatewayCourse, node: GatewayNode): Promise<boolean> {
    const position = Number(node.extra?.["viewedSeconds"] ?? 0);
    const total = node.durationSeconds || Number(node.extra?.["duration"] ?? 0);
    for (let attempt = 1; attempt <= RED_ATTEMPT_LIMIT; attempt++) {
      if (stopRequested()) return false;
      try {
        const res = await withSession((s) =>
          gateway.study(
            s,
            {
              courseId: course.id,
              nodeId: node.id,
              action: "progress",
              positionSeconds: position,
              durationSeconds: total,
            },
            { signal },
          ),
        );
        const msg = res.message ?? "";
        const rawText =
          typeof res.raw === "string" ? res.raw : JSON.stringify(res.raw ?? "");

        if (RED_MESSAGES.some((p) => msg.includes(p) || rawText.includes(p))) {
          emitLog(
            "warn",
            `去红未通过（第 ${attempt}/${RED_ATTEMPT_LIMIT} 次）：${course.name} / ${node.name}`,
          );
          await sleep(RED_OK_INTERVAL_MS, signal);
          continue;
        }
        if (msg.includes("提交学时成功")) {
          flagSet.delete(node.id);
          clearNodeFlag(accountUid, course.id, node.id);
          emitLog(
            "info",
            `去红成功：${course.name} / ${node.name}（已看 ${position}s，间隔 ${RED_OK_INTERVAL_MS / 1000}s 后继续）`,
          );
          await sleep(RED_OK_INTERVAL_MS, signal);
          return true;
        }
        if (UNLOCK_RE.test(msg)) {
          emitLog("warn", `去红跳过（未到解锁时间）：${course.name} / ${node.name}`);
          return true;
        }
        if (RELOGIN_RE.test(msg) || rawText.includes("账号登录超时")) {
          emitLog("warn", "去红遇到登录超时，正在重建会话后重试…");
          sid = await abortable(rebuildSession(accountUid), signal);
          continue;
        }
        emitLog(
          "warn",
          `去红未确认（${(msg || "无文案").slice(0, 40)}），10 秒后重试：${course.name} / ${node.name}`,
        );
        await sleep(RED_FAIL_INTERVAL_MS, signal);
      } catch (err) {
        emitLog(
          "warn",
          `去红请求失败：${(err as Error).message}，10 秒后重试：${course.name} / ${node.name}`,
        );
        await sleep(RED_FAIL_INTERVAL_MS, signal);
      }
    }
    emitLog("warn", `去红未收敛：${course.name} / ${node.name}（可稍后再跑一次去红模式）`);
    return false;
  }

  /**
   * 课程级去红：目标是本次运行中检测到的标红节点 + 数据库里的历史标红节点。
   * 每轮只重跑仍未通过的节点，最多 RED_ROUND_LIMIT 轮（console 是无限递归，这里加上限防挂死）。
   */
  async function cleanRedCourse(course: GatewayCourse, nodes: GatewayNode[]): Promise<void> {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const targets = new Set<string>();
    for (const id of flaggedNodeIds(accountUid, course.id)) {
      if (byId.has(id)) targets.add(id);
    }
    for (const id of flagSet) {
      if (byId.has(id)) targets.add(id);
    }
    if (targets.size === 0) {
      emitLog("info", `去红：${course.name} 没有标红节点，跳过`);
      return;
    }
    let remaining = [...targets];
    for (let round = 1; round <= RED_ROUND_LIMIT && remaining.length > 0; round++) {
      if (stopRequested()) return;
      emitLog(
        "info",
        `去红第 ${round}/${RED_ROUND_LIMIT} 轮：${course.name}，待清理 ${remaining.length} 个标红节点`,
      );
      const next: string[] = [];
      for (const id of remaining) {
        if (stopRequested()) return;
        const node = byId.get(id);
        if (!node) continue;
        const ok = await cleanRedNode(course, node);
        if (!ok) next.push(id);
      }
      remaining = next;
    }
    if (remaining.length > 0) {
      emitLog(
        "warn",
        `去红未完全收敛：${course.name} 仍有 ${remaining.length} 个节点标红，建议稍后再跑一次去红模式`,
      );
    } else {
      emitLog("info", `去红完成：${course.name}`);
    }
  }

  async function runCourse(
    course: GatewayCourse,
    tasks: Map<string, NodeTasks>,
  ): Promise<void> {
    await waitIfPaused();
    if (stopRequested()) return;
    emit({ type: "task.progress", phase: "video", courseId: course.id, courseName: course.name, ...jobOverview() });
    const tree = await withSession((s) => gateway.tree(s, course.id, { signal }));
    const nodes = flattenNodes(tree);
    nodesByCourse.set(course.id, nodes);
    emit({ type: "task.progress", phase: "video", courseId: course.id, courseName: course.name, ...jobOverview() });
    const videoCount = nodes.filter(isVideoNode).length;
    const mode = options.videoMode;

    // 去红模式：不刷正常视频，只清理被平台标红的节点，然后照常处理这些节点上的作业/考试
    if (mode === 3) {
      emitLog("info", `开始课程：${course.name}（去红：只处理标红节点）`);
      await cleanRedCourse(course, nodes);
      for (const n of nodes) {
        if (stopRequested()) return;
        await runNodeTasks(course, n, tasks);
      }
      emitLog("info", `课程结束：${course.name}`);
      doneCourses.add(course.id);
      emit({ type: "task.progress", phase: "video", courseId: course.id, courseName: course.name, ...jobOverview() });
      return;
    }

    emitLog(
      "info",
      `开始课程：${course.name}（待学视频 ${videoCount} 个，模式：${MODE_LABELS[mode]}）`,
    );

    if (mode === 2) {
      // 暴力模式：节点并发（同一账号的 SDK 调用会被网关串行，等待节奏仍并行）
      let blocked = false;
      await runPool(nodes, options.perCourseConcurrency, async (n) => {
        if (blocked || stopRequested()) return;
        if (isVideoNode(n)) {
          const r = await studyVideo(course, n);
          if (r === "blocked") blocked = true;
        }
        await runNodeTasks(course, n, tasks);
      });
      // 暴力模式结束后自动去红（对齐 console：暴力刷完容易触发并行播放标记）
      emitLog("info", `暴力模式已结束，正在自动执行去红：${course.name}`);
      await cleanRedCourse(course, nodes);
    } else {
      // 普通模式：节点串行；作业/考试在该节点刷完后立刻处理（对齐 console 的时机）
      for (const n of nodes) {
        if (stopRequested()) return;
        let blocked = false;
        if (isVideoNode(n)) {
          const r = await studyVideo(course, n);
          if (r === "blocked") blocked = true;
        }
        await runNodeTasks(course, n, tasks);
        if (blocked) {
          emitLog("warn", `课程 ${course.name} 剩余节点被前置锁挡住，跳过`);
          break;
        }
      }
    }
    if (!stopRequested() && nodes.every((n) => !isVideoNode(n))) doneCourses.add(course.id);
    emitLog("info", `课程结束：${course.name}`);
    emit({ type: "task.progress", phase: "video", courseId: course.id, courseName: course.name, ...jobOverview() });
  }

  // ---------- 主流程 ----------
  try {
    courses = await withSession((s) => gateway.courses(s, { signal }));
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

  const courseLimit = Math.min(settings.maxCoursesConcurrency, courses.length);
  emitLog(
    "info",
    `任务启动：${courses.length} 门课程，模式 ${MODE_LABELS[options.videoMode]}；` +
      `同一账号最多 ${courseLimit} 门课同时推进；答题来源 ${
        options.answerSource === "off" ? "关闭" : options.answerSource
      }`,
  );

  await runPool(courses, courseLimit, async (course) => {
    if (stopRequested()) return;
    try {
      const tasks = await loadNodeTasks(course);
      await runCourse(course, tasks);
    } catch (err) {
      const m = `课程 ${course.name}: ${(err as Error).message}`;
      summary.errors.push(m);
      emitLog("error", m);
    }
  });

  if (stopRequested()) {
    emitLog("info", "任务已停止（当前节点已保存进度）");
  }
  // 收尾课程快照：邮件通知按课程展示名称/进度/总时长，页面详情也能看到
  summary.courseResults = jobOverview().coursesProgress.map((c) => ({
    name: c.courseName,
    progress: c.progress,
    completed: c.completed,
    totalSeconds: c.totalSeconds,
  }));
  emitLog(
    "info",
    `任务结束：完成视频 ${summary.videosCompleted}，跳过 ${summary.videosSkipped}，标红 ${summary.flagsFound}，错误 ${summary.errors.length}`,
  );
  return summary;
}
