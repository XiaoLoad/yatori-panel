import type { FastifyInstance } from "fastify";
import "@fastify/cookie";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";
import {
  AnswerSourceEnum,
  CreateAccountBody,
  CreateScheduleBody,
  StartJobBody,
  UpdateAccountBody,
  UpdateSettingsBody,
} from "./shared.ts";
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
import { eventsForJob, getJob, listJobs } from "./db/jobs.ts";
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
    const account = getAccount(body.accountUid);
    if (!account) throw new HttpError(404, "账号不存在");
    const job = insertSchedule(body);
    registerSchedule(job);
    return { ok: true, data: job };
  });

  app.post("/api/v1/schedules/:id/toggle", async (req) => {
    const schedule = getSchedule((req.params as { id: string }).id);
    if (!schedule) throw new HttpError(404, "定时任务不存在");
    const enabled = !schedule.enabled;
    setScheduleEnabled(schedule.id, enabled);
    if (enabled) registerSchedule(schedule);
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

  // 单场考试触发：与任务发起同一套答题来源预检门禁，不可用直接拒绝
  app.post("/api/v1/accounts/:uid/courses/:courseId/exams/do", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        examId: z.string({ required_error: "缺少考试 ID" }).min(1, "缺少考试 ID"),
        source: AnswerSourceEnum,
        submit: z.boolean().optional().default(false),
      }),
    );
    if (body.source !== "off") {
      const settings = getSettings();
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
    const sid = await ensureSession(account);
    const r = await gateway.doExam(sid, {
      courseId,
      examId: body.examId,
      source: body.source,
      submit: body.submit,
    });
    return { ok: true, data: r };
  });

  // ---------- 任务 ----------
  app.post("/api/v1/jobs", async (req) => {
    const body = parse<StartJobBody>(req.body, StartJobBody);
    const account = getAccount(body.accountUid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (!account.enabled) throw new HttpError(400, "账号已被禁用");

    // 答题来源预检：AI/题库不可用时直接拒绝启动（对齐 console 的前置检查）
    if (body.answerSource !== "off") {
      const settings = getSettings();
      const pre =
        body.answerSource === "ai"
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
        const label = body.answerSource === "ai" ? "AI" : "外置题库";
        throw new HttpError(400, `${label}预检未通过：${pre.error ?? "不可用"}`);
      }
    }

    const job = await jobManager.start(account, body);
    return { ok: true, data: job };
  });

  app.post("/api/v1/jobs/:id/stop", async (req) => {
    const { id } = req.params as { id: string };
    if (!jobManager.stop(id)) {
      const job = getJob(id);
      if (!job) throw new HttpError(404, "任务不存在");
      return { ok: true, data: { stopped: false, reason: "任务已结束" } };
    }
    return { ok: true, data: { stopped: true } };
  });

  app.get("/api/v1/jobs", async (req) => {
    const q = req.query as { accountUid?: string; state?: string; limit?: string };
    return {
      ok: true,
      data: listJobs({
        accountUid: q.accountUid,
        state: q.state,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    };
  });

  app.get("/api/v1/jobs/:id", async (req) => {
    const job = getJob((req.params as { id: string }).id);
    if (!job) throw new HttpError(404, "任务不存在");
    return { ok: true, data: { ...job, events: eventsForJob(job.id) } };
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
