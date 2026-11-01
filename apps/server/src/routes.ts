import type { FastifyInstance } from "fastify";
import "@fastify/cookie";
import type { ZodType, ZodTypeDef } from "zod";
import {
  CreateAccountBody,
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
import { getSettings, saveSettings } from "./db/settings.ts";
import { HttpError } from "./errors.ts";
import { GatewayError, gateway } from "./gateway.ts";
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
  app.get("/api/v1/health", async () => {
    let gatewayOk = false;
    try {
      await gateway.health();
      gatewayOk = true;
    } catch {
      gatewayOk = false;
    }
    return { ok: true, data: { status: "up", gateway: gatewayOk ? "up" : "down" } };
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
