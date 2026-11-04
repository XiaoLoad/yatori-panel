import type { FastifyInstance } from "fastify";
import "@fastify/cookie";
import {
  authRequired,
  issueSession,
  revokeAllSessions,
  SESSION_COOKIE,
  setPassword,
  touchAuthStamp,
  verifyPassword,
  verifySession,
} from "../db/auth.ts";
import { sqlite } from "../db/index.ts";
import { HttpError } from "../errors.ts";

/** 访问锁：状态查询、登录、登出、密码设置与关闭 */
export function registerAuthRoutes(app: FastifyInstance): void {
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
}
