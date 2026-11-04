import type { FastifyInstance } from "fastify";
import "@fastify/cookie";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";
import {
  AnswerSourceEnum,
  BatchStartJobBody,
  CreateAccountBody,
  CreateScheduleBody,
  DeleteLogsBody,
  StartJobBody,
  SubmitModeEnum,
  UpdateAccountBody,
  UpdateSettingsBody,
} from "./shared.ts";
import type { BatchStartResult } from "./shared.ts";
import { bus } from "./bus.ts";
import {
  countAccountsByPlatform,
  deleteAccount,
  getAccount,
  insertAccount,
  listAccounts,
  markVerify,
  updateAccount,
} from "./db/accounts.ts";
import {
  deleteLogEvents,
  eventsForJob,
  finishJob,
  getJob,
  listJobs,
  pageJobs,
  pageLogEvents,
  recentLogEvents,
} from "./db/jobs.ts";
import {
  authRequired,
  issueSession,
  revokeAllSessions,
  SESSION_COOKIE,
  setPassword,
  touchAuthStamp,
  verifyPassword,
  verifySession,
} from "./db/auth.ts";
import { sqlite } from "./db/index.ts";
import {
  deleteSchedule,
  getSchedule,
  insertSchedule,
  listSchedules,
  setScheduleEnabled,
} from "./db/schedules.ts";
import { registerSchedule, unregisterSchedule } from "./scheduler.ts";
import cron from "node-cron";
import { parse as parseYaml } from "yaml";
import { getSettings, saveSettings } from "./db/settings.ts";
import { HttpError } from "./errors.ts";
import { GatewayError, gateway } from "./gateway.ts";
import { refreshGatewayStatus, snapshot } from "./gateway-status.ts";
import { jobManager } from "./jobs/manager.ts";
import { dropSession, ensureSession, getSessionId, getSessionState } from "./sessions.ts";
import { isExamRunning, listRunningExams, runSingleExam } from "./single-exam.ts";
import { isWorkRunning, listRunningWorks, runSingleWork } from "./single-work.ts";

/** 部分平台账号未填 baseUrl 时的默认网页入口 */
const PLATFORM_ENTRY: Record<string, string> = {
  XUEXITONG: "https://www.chaoxing.com",
};

/** AI/题库配置的零成本前置校验：缺配置直接拒绝，不发起注定失败的探针请求 */
function ensureAnswerConfigReady(
  source: "off" | "ai" | "bank",
  settings: ReturnType<typeof getSettings>,
): void {
  if (source === "ai" && (!settings.ai.enabled || !settings.ai.url || !settings.ai.apiKey)) {
    throw new HttpError(400, "请先在全局设置中完成 AI 答题配置（接口地址与 API Key 必填）");
  }
  if (source === "bank" && (!settings.questionBank.enabled || !settings.questionBank.url)) {
    throw new HttpError(400, "请先在全局设置中启用外置题库并填写服务地址");
  }
}

/** 答题来源可用性校验：批量/单个任务共用，避免重复预检逻辑 */
async function assertAnswerSourceReady(source: "off" | "ai" | "bank"): Promise<void> {
  if (source === "off") return;
  const settings = getSettings();
  ensureAnswerConfigReady(source, settings);
  const pre =
    source === "ai"
      ? await gateway.preflight({
          source: "ai",
          ai: {
            type: settings.ai.type,
            url: settings.ai.url,
            model: settings.ai.model,
            apiKey: settings.ai.apiKey,
          },
        })
      : await gateway.preflight({
          source: "bank",
          questionBank: {
            url: settings.questionBank.url,
            key: settings.questionBank.key,
          },
        });
  if (!pre.available) {
    const label = source === "ai" ? "AI" : "外置题库";
    throw new HttpError(400, `${label}预检未通过：${pre.error ?? "不可用"}`);
  }
}

function parse<T>(body: unknown, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  }
  return r.data;
}

export function registerRoutes(app: FastifyInstance): void {
  // ---------- 访问锁 ----------
  app.get("/api/v1/auth/status", async (req) => {
    const required = authRequired();
    return {
      ok: true,
      data: {
        authRequired: required,
        authed: required ? verifySession(req.cookies[SESSION_COOKIE]) : true,
      },
    };
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as { password?: string };
    if (!authRequired()) {
      throw new HttpError(400, "面板未设置访问密码，无需登录");
    }
    if (!body.password || !verifyPassword(body.password)) {
      throw new HttpError(401, "密码错误");
    }
    const { token, expires } = issueSession();
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expires,
    });
    return { ok: true };
  });

  app.post("/api/v1/auth/logout", async (_req, reply) => {
    revokeAllSessions();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // 关闭访问锁：吊销全部会话并清除密码（需要当前已登录）
  app.delete("/api/v1/auth/password", async (req, reply) => {
    if (authRequired() && !verifySession(req.cookies[SESSION_COOKIE])) {
      throw new HttpError(401, "未登录或会话已过期");
    }
    sqlite
      .prepare(`DELETE FROM settings WHERE key = 'panelAuth'`)
      .run();
    touchAuthStamp();
    revokeAllSessions();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // 未设密码时放行（首次启用）；已设密码则必须携带有效会话（修改密码）
  app.put("/api/v1/auth/password", async (req, reply) => {
    const body = (req.body ?? {}) as { newPassword?: string };
    if (!body.newPassword || body.newPassword.length < 6) {
      throw new HttpError(400, "密码至少 6 位");
    }
    if (authRequired() && !verifySession(req.cookies[SESSION_COOKIE])) {
      throw new HttpError(401, "未登录或会话已过期");
    }
    setPassword(body.newPassword);
    touchAuthStamp();
    revokeAllSessions(); // 改密后吊销所有旧会话，再为当前用户补发新会话
    const { token, expires } = issueSession();
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expires,
    });
    return { ok: true };
  });

  // ---------- 基础 ----------
  // 网关状态由后台心跳维护（gateway-status.ts），这里只读快照；detail 供前端诊断提示
  app.get("/api/v1/health", async () => {
    const s = snapshot();
    return {
      ok: true,
      data: {
        status: "up",
        gateway: s.up ? "up" : "down",
        detail: s.detail,
        downAt: s.downAt,
        upAt: s.upAt,
      },
    };
  });

  // 前端"重新检测"按钮：立即探测而非等下一个心跳周期
  app.post("/api/v1/health/recheck", async () => {
    const s = await refreshGatewayStatus();
    return {
      ok: true,
      data: { status: "up", gateway: s.up ? "up" : "down", detail: s.detail, downAt: s.downAt, upAt: s.upAt },
    };
  });

  app.get("/api/v1/platforms", async () => {
    return { ok: true, data: await gateway.platforms() };
  });

  // AI/题库配置预检代理（设置页测试按钮与发起任务门禁共用）
  app.post("/api/v1/preflight", async (req) => {
    const body = (req.body ?? {}) as Parameters<typeof gateway.preflight>[0];
    return { ok: true, data: await gateway.preflight(body) };
  });

  // ---------- 账号 ----------
  // 备注为空时用平台上的真实姓名自动补全（当前英华支持），失败静默跳过
  async function autoFillRemark(uid: string, currentRemark: string, sid: string): Promise<string> {
    if (currentRemark) return currentRemark;
    try {
      const profile = await gateway.profile(sid);
      if (profile.name) {
        updateAccount(uid, { remark: profile.name });
        return profile.name;
      }
    } catch {
      /* 平台不支持或页面结构变化：不影响主流程 */
    }
    return currentRemark;
  }

  app.get("/api/v1/accounts", async () => {
    const accounts = listAccounts();
    return {
      ok: true,
      data: accounts.map((a) => ({
        ...a,
        hasSession: !!getSessionId(a.uid),
        sessionState: getSessionState(a.uid),
      })),
    };
  });

  app.post("/api/v1/accounts", async (req) => {
    const body = parse<CreateAccountBody>(req.body, CreateAccountBody);
    if (
      countAccountsByPlatform(body.platform, body.baseUrl, body.username) > 0
    ) {
      throw new HttpError(409, "该账号已存在");
    }
    const account = insertAccount({
      platform: body.platform,
      baseUrl: body.baseUrl,
      username: body.username,
      password: body.password,
      remark: body.remark,
      proxyUrl: body.proxyUrl ?? "",
    });

    if (body.verify) {
      try {
        const sid = await ensureSession({ ...account, password: body.password });
        const courses = await gateway.courses(sid);
        markVerify(account.uid, true);
        const remark = await autoFillRemark(account.uid, account.remark, sid);
        return {
          ok: true,
          data: {
            ...account,
            remark,
            verify: { ok: true, courseCount: courses.length },
          },
        };
      } catch (err) {
        const e = err as HttpError;
        markVerify(account.uid, false);
        await dropSession(account.uid);
        return {
          ok: false,
          error: e.message,
          logs: e.logs,
          data: { ...account, verify: { ok: false } },
        };
      }
    }
    return { ok: true, data: account };
  });

  app.post("/api/v1/accounts/:uid/verify", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    try {
      const sid = await ensureSession(account);
      const courses = await gateway.courses(sid);
      markVerify(account.uid, true);
      const remark = await autoFillRemark(account.uid, account.remark, sid);
      return { ok: true, data: { ok: true, courseCount: courses.length, remark } };
    } catch (err) {
      const e = err as HttpError;
      markVerify(account.uid, false);
      await dropSession(account.uid);
      return { ok: false, error: e.message, logs: e.logs, data: { ok: false } };
    }
  });

  // 账号登录信息：用于“打开平台并复制账号密码”，密码仅在按需请求时返回
  app.get("/api/v1/accounts/:uid/credentials", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const entryUrl = account.baseUrl || PLATFORM_ENTRY[account.platform] || "";
    return {
      ok: true,
      data: { username: account.username, password: account.password, entryUrl },
    };
  });

  app.put("/api/v1/accounts/:uid", async (req) => {
    const { uid } = req.params as { uid: string };
    const body = parse<UpdateAccountBody>(req.body, UpdateAccountBody);
    if (!getAccount(uid)) throw new HttpError(404, "账号不存在");
    updateAccount(uid, body);
    await dropSession(uid); // 凭据可能变了，强制下次重建会话
    return { ok: true };
  });

  app.delete("/api/v1/accounts/:uid", async (req) => {
    const { uid } = req.params as { uid: string };
    jobManager.stopByAccount(uid);
    await dropSession(uid);
    deleteAccount(uid);
    return { ok: true };
  });

  // ---------- 定时任务 ----------
  app.get("/api/v1/schedules", async () => {
    return { ok: true, data: listSchedules() };
  });

  app.post("/api/v1/schedules", async (req) => {
    const body = parse<CreateScheduleBody>(req.body, CreateScheduleBody);
    if (!cron.validate(body.cron)) {
      throw new HttpError(400, "cron 表达式无效");
    }
    for (const uid of body.accountUids) {
      if (!getAccount(uid)) throw new HttpError(404, "定时规则包含不存在的账号");
    }
    const job = insertSchedule({
      name: body.name,
      accountUids: body.accountUids,
      cron: body.cron,
      endTime: body.endTime,
      stopMode: body.stopMode,
      videoMode: body.videoMode,
      answerSource: body.answerSource,
      submitMode: body.submitMode,
    });
    registerSchedule(job);
    return { ok: true, data: job };
  });

  app.post("/api/v1/schedules/:id/toggle", async (req) => {
    const schedule = getSchedule((req.params as { id: string }).id);
    if (!schedule) throw new HttpError(404, "定时任务不存在");
    const enabled = !schedule.enabled;
    setScheduleEnabled(schedule.id, enabled);
    if (enabled) registerSchedule({ ...schedule, enabled: true });
    else unregisterSchedule(schedule.id);
    return { ok: true, data: { enabled } };
  });

  app.delete("/api/v1/schedules/:id", async (req) => {
    const { id } = req.params as { id: string };
    unregisterSchedule(id);
    deleteSchedule(id);
    return { ok: true };
  });

  // config.yaml 批量导入（对齐 console 的配置结构）
  app.post("/api/v1/accounts/import", async (req) => {
    const body = (req.body ?? {}) as { yaml?: string };
    if (!body.yaml?.trim()) throw new HttpError(400, "请提供 config.yaml 内容");
    if (body.yaml.length > 512 * 1024) throw new HttpError(400, "文件过大");

    let parsed: {
      users?: {
        accountType?: string;
        url?: string;
        account?: string;
        password?: string;
        remarkName?: string;
      }[];
    };
    try {
      parsed = parseYaml(body.yaml);
    } catch (err) {
      throw new HttpError(400, `YAML 解析失败：${(err as Error).message}`);
    }
    const users = parsed.users ?? [];
    if (!users.length) throw new HttpError(400, "config.yaml 中没有 users 配置");

    // 平台别名归一（对齐 core 的 platformAliases 子集）
    const alias: Record<string, string> = {
      YINGHUA: "YINGHUA", XUEXITONG: "XUEXITONG", XXT: "XUEXITONG", CHAOXING: "XUEXITONG",
      ICVE: "ICVE", ZJY: "ICVE", CQIE: "CQIE", ENAAE: "ENAAE", WELEARN: "WELEARN",
      QSXT: "QSXT", QINGSHUXUETANG: "QSXT", TTCDW: "TTCDW", KETANGX: "KETANGX",
      ZXCPKS: "ZXCPKS", HAIQIKEJI: "ZXCPKS", WEIBAN: "WEIBAN", ZHIHUISHU: "ZHIHUISHU", GONGXUE: "GONGXUE",
    };

    const result = { imported: 0, skipped: 0, failed: [] as { account: string; error: string }[] };
    for (const u of users) {
      const rawType = (u.accountType ?? "").trim();
      const platform = alias[rawType.toUpperCase()];
      const username = (u.account ?? "").trim();
      const password = (u.password ?? "").trim();
      if (!platform || !username || !password) {
        result.failed.push({ account: username || "(空)", error: "缺少平台/账号/密码字段" });
        continue;
      }
      try {
        insertAccount({
          platform,
          baseUrl: (u.url ?? "").trim(),
          username,
          password,
          remark: (u.remarkName ?? "").trim(),
        });
        result.imported += 1;
      } catch (err) {
        result.failed.push({ account: username, error: (err as Error).message });
      }
    }
    return { ok: true, data: result };
  });

  // ---------- 课程 ----------
  app.get("/api/v1/accounts/:uid/courses", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.courses(sid) };
  });

  app.get("/api/v1/accounts/:uid/courses/:courseId/tree", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.tree(sid, courseId) };
  });

  // 考试列表透传（单场考试快捷触发的前置数据）
  app.get("/api/v1/accounts/:uid/courses/:courseId/exams", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.exams(sid, courseId) };
  });

  // 考试状态与成绩只读查询：仅英华，不进入考试、不消耗答题次数
  app.post("/api/v1/accounts/:uid/courses/:courseId/exams/results", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (account.platform !== "YINGHUA") {
      throw new HttpError(400, "考试状态与成绩查询暂仅支持英华学堂");
    }
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        exams: z
          .array(
            z.object({
              examId: z.string({ required_error: "缺少考试 ID" }).min(1, "缺少考试 ID"),
              nodeId: z.string({ required_error: "缺少节点 ID" }).min(1, "缺少节点 ID"),
            }),
          )
          .min(1, "缺少考试列表")
          .max(30, "单次最多查询 30 场考试"),
      }),
    );
    const sid = await ensureSession(account);
    return {
      ok: true,
      data: await gateway.examResults(sid, { courseId, exams: body.exams }),
    };
  });

  // 单场考试触发：与任务发起同一套答题来源预检门禁，不可用直接拒绝。
  // 后台执行 + SSE 实时状态（同步 HTTP 会让答题期间前端无任何反馈）。
  app.post("/api/v1/accounts/:uid/courses/:courseId/exams/do", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        examId: z.string({ required_error: "缺少考试 ID" }).min(1, "缺少考试 ID"),
        examName: z.string().optional().default(""),
        source: AnswerSourceEnum,
        submitMode: SubmitModeEnum.optional().default("direct"),
      }),
    );
    if (isExamRunning(account.uid, courseId, body.examId)) {
      throw new HttpError(409, "该考试正在答题中，请等待完成");
    }
    if (body.source !== "off") {
      const settings = getSettings();
      ensureAnswerConfigReady(body.source, settings);
      const pre =
        body.source === "ai"
          ? await gateway.preflight({
              source: "ai",
              ai: {
                type: settings.ai.type,
                url: settings.ai.url,
                model: settings.ai.model,
                apiKey: settings.ai.apiKey,
              },
            })
          : await gateway.preflight({
              source: "bank",
              questionBank: {
                url: settings.questionBank.url,
                key: settings.questionBank.key,
              },
            });
      if (!pre.available) {
        const label = body.source === "ai" ? "AI" : "外置题库";
        throw new HttpError(400, `${label}预检未通过：${pre.error ?? "不可用"}`);
      }
    }
    await ensureSession(account);
    const examName = body.examName || body.examId;
    // 查课程名用于日志标识（查不到不影响触发）
    let courseName: string | undefined;
    try {
      const sid = await ensureSession(account);
      courseName = (await gateway.courses(sid)).find((c) => c.id === courseId)?.name;
    } catch {
      /* 仅日志标识用途，失败不阻断 */
    }
    void runSingleExam({
      accountUid: account.uid,
      courseId,
      examId: body.examId,
      examName,
      courseName,
      source: body.source,
      submitMode: body.submitMode,
    });
    return { ok: true, data: { started: true, examName } };
  });

  // 单场考试运行状态（前端刷新页面后恢复"答题中"显示）
  app.get("/api/v1/accounts/:uid/exams/running", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    return {
      ok: true,
      data: listRunningExams().filter((r) => r.accountUid === account.uid),
    };
  });

  // 作业列表透传（单场作业快捷触发的前置数据）
  app.get("/api/v1/accounts/:uid/courses/:courseId/works", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.works(sid, courseId) };
  });

  // 作业状态与成绩只读查询：仅英华，不进入作答流程、不消耗做题次数
  app.post("/api/v1/accounts/:uid/courses/:courseId/works/results", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (account.platform !== "YINGHUA") {
      throw new HttpError(400, "作业状态与成绩查询暂仅支持英华学堂");
    }
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        works: z
          .array(
            z.object({
              workId: z.string({ required_error: "缺少作业 ID" }).min(1, "缺少作业 ID"),
              nodeId: z.string({ required_error: "缺少节点 ID" }).min(1, "缺少节点 ID"),
            }),
          )
          .min(1, "缺少作业列表")
          .max(30, "单次最多查询 30 份作业"),
      }),
    );
    const sid = await ensureSession(account);
    return {
      ok: true,
      data: await gateway.workResults(sid, { courseId, works: body.works }),
    };
  });

  // 单场作业触发（支持批量）：与单场考试同一套答题来源预检门禁，后台执行 + SSE 实时状态
  app.post("/api/v1/accounts/:uid/courses/:courseId/works/do", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        works: z
          .array(
            z.object({
              workId: z.string({ required_error: "缺少作业 ID" }).min(1, "缺少作业 ID"),
              workName: z.string().optional().default(""),
            }),
          )
          .min(1, "至少选择一份作业")
          .max(50, "单次最多批量完成 50 份作业"),
        source: AnswerSourceEnum,
        /** 提交模式：true 答完提交（默认），false 仅保存草稿 */
        submit: z.boolean().optional().default(true),
      }),
    );
    for (const w of body.works) {
      if (isWorkRunning(account.uid, courseId, w.workId)) {
        throw new HttpError(409, `作业「${w.workName || w.workId}」正在答题中，请等待完成`);
      }
    }
    await assertAnswerSourceReady(body.source);
    await ensureSession(account);
    // 查课程名用于日志标识（查不到不影响触发）
    let courseName: string | undefined;
    try {
      const sid = await ensureSession(account);
      courseName = (await gateway.courses(sid)).find((c) => c.id === courseId)?.name;
    } catch {
      /* 仅日志标识用途，失败不阻断 */
    }
    void runSingleWork({
      accountUid: account.uid,
      courseId,
      works: body.works.map((w) => ({ workId: w.workId, workName: w.workName })),
      courseName,
      source: body.source,
      submit: body.submit,
    });
    return {
      ok: true,
      data: { started: true, count: body.works.length, names: body.works.map((w) => w.workName || w.workId) },
    };
  });

  // 单场作业运行状态（前端刷新页面后恢复"答题中"显示）
  app.get("/api/v1/accounts/:uid/works/running", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    return {
      ok: true,
      data: listRunningWorks().filter((r) => r.accountUid === account.uid),
    };
  });

  // ---------- 任务 ----------
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
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(q.pageSize) || 20));
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
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
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

  // ---------- 设置 ----------
  app.get("/api/v1/settings", async () => {
    return { ok: true, data: getSettings() };
  });

  app.put("/api/v1/settings", async (req) => {
    const body = parse<UpdateSettingsBody>(req.body, UpdateSettingsBody);
    saveSettings(body);
    return { ok: true };
  });

  // ---------- 统计 ----------
  app.get("/api/v1/stats/daily", async (req) => {
    const q = req.query as { days?: string };
    const days = Math.min(60, Math.max(7, Number(q.days) || 14));
    const rows = sqlite
      .prepare(
        `SELECT substr(started_at, 1, 10) AS day,
                COUNT(*) AS jobs,
                SUM(CASE WHEN state = 'error' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(CAST(json_extract(summary_json, '$.videosCompleted') AS INTEGER)), 0) AS videos
         FROM jobs
         WHERE started_at >= datetime('now', ?)
         GROUP BY day ORDER BY day`,
      )
      .all(`-${days - 1} days`) as { day: string; jobs: number; errors: number; videos: number }[];
    // 补齐空缺日期，保证图表时间轴连续
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: { day: string; jobs: number; errors: number; videos: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const hit = byDay.get(d);
      out.push({ day: d, jobs: hit?.jobs ?? 0, errors: hit?.errors ?? 0, videos: hit?.videos ?? 0 });
    }
    return { ok: true, data: out };
  });

  // ---------- 仪表盘 ----------
  app.get("/api/v1/dashboard", async () => {
    const accounts = listAccounts();
    const running = listJobs({ state: "running" });
    const recent = listJobs({ limit: 5 });
    return {
      ok: true,
      data: {
        accountCount: accounts.length,
        onlineAccounts: accounts.filter((a) => getSessionId(a.uid)).length,
        runningJobs: running.length,
        recentJobs: recent,
      },
    };
  });

  // ---------- SSE 事件流 ----------
  app.get("/api/v1/events/stream", async (req, reply) => {
    const q = req.query as { accountId?: string; jobId?: string };
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write("retry: 3000\n\n");

    const send = (e: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* 连接已断 */
      }
    };
    send({ type: "hello", ts: Date.now() });
    // 新订阅者立即获知当前网关状态，无需等下一次 up/down 变化
    const gs = snapshot();
    send({ type: "gateway.status", ts: Date.now(), up: gs.up, detail: gs.detail });
    const unsubscribe = bus.subscribe(
      { accountId: q.accountId, jobId: q.jobId },
      send,
    );
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        /* ignore */
      }
    }, 15_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return reply; // 挂起，长连接由 close 事件收尾
  });

  // ---------- 统一错误处理 ----------
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ ok: false, error: err.message, logs: err.logs });
      return;
    }
    if (err instanceof GatewayError) {
      reply.code(err.status).send({ ok: false, error: err.message, logs: err.logs });
      return;
    }
    if (err instanceof Error && "statusCode" in err) {
      // fastify 内建错误（如 JSON 解析失败）
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      reply.code(status).send({ ok: false, error: err.message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ ok: false, error: (err as Error).message });
  });
}
