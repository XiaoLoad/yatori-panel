import type { FastifyInstance, FastifyRequest } from "fastify";
import "@fastify/cookie";
import {
  authRequired,
  issueSession,
  isGeneratedPassword,
  listSessions,
  passwordPolicyError,
  registerSession,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  sessionIdOf,
  SESSION_COOKIE,
  clearPassword,
  setPassword,
  touchAuthStamp,
  touchSessionSeen,
  verifyPassword,
  verifySession,
} from "../db/auth.ts";
import { now, sqlite } from "../db/index.ts";
import { env } from "../env.ts";
import { HttpError } from "../errors.ts";

// ---------- 登录防爆破（落库，重启不清零） ----------
// 同一 IP 连续失败 MAX_FAILURES 次后锁定 LOCKOUT_MS；成功登录即清零。
// 计数持久化到 login_throttle 表（schema v5）：攻击者可通过反复触发面板重启
// （例如容器崩溃循环）清空内存计数绕过锁定，落库后锁定期跨重启仍然生效。
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function clientIp(req: FastifyRequest): string {
  // trustProxy 开启时 Fastify 已解析 X-Forwarded-For；否则直连取 socket 地址
  return req.ip || "unknown";
}

interface ThrottleRow {
  ip: string;
  fail_count: number;
  locked_until: number;
}

function loginGate(req: FastifyRequest): void {
  const rec = sqlite
    .prepare(`SELECT ip, fail_count, locked_until FROM login_throttle WHERE ip = ?`)
    .get(clientIp(req)) as ThrottleRow | undefined;
  if (rec && rec.locked_until > Date.now()) {
    const minutes = Math.ceil((rec.locked_until - Date.now()) / 60_000);
    throw new HttpError(429, `失败次数过多，请 ${minutes} 分钟后重试`);
  }
}

function recordLoginFailure(req: FastifyRequest): void {
  const ip = clientIp(req);
  const rec = sqlite
    .prepare(`SELECT ip, fail_count, locked_until FROM login_throttle WHERE ip = ?`)
    .get(ip) as ThrottleRow | undefined;
  const count = (rec?.fail_count ?? 0) + 1;
  const lockedUntil = count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0;
  sqlite
    .prepare(
      `INSERT INTO login_throttle (ip, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fail_count = excluded.fail_count,
         locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    )
    .run(ip, lockedUntil ? 0 : count, lockedUntil, now());
}

function recordLoginSuccess(req: FastifyRequest): void {
  sqlite.prepare(`DELETE FROM login_throttle WHERE ip = ?`).run(clientIp(req));
}

/** 会话 cookie 属性：secure 由环境变量控制（HTTP 部署必须关闭，否则浏览器拒绝回传） */
function sessionCookie(expires: Date) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    expires,
  } as const;
}

/** 访问锁：状态查询、登录（防爆破）、登出、密码设置（旧密码校验）与关闭 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/auth/status", async (req) => {
    const required = authRequired();
    return {
      ok: true,
      data: {
        authRequired: required,
        authed: required ? verifySession(req.cookies[SESSION_COOKIE]) : true,
        /** 当前密码是否为系统生成的初始密码（提示用户尽快更换） */
        initialPassword: required ? isGeneratedPassword() : false,
        /** 部署配置强制访问锁（生产环境不允许运行时关闭） */
        lockEnforced: env.authRequired,
      },
    };
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    if (!authRequired()) {
      throw new HttpError(400, "面板未设置访问密码，无需登录");
    }
    loginGate(req);
    const body = (req.body ?? {}) as { password?: string };
    if (!body.password || !verifyPassword(body.password)) {
      recordLoginFailure(req);
      throw new HttpError(401, "密码错误");
    }
    recordLoginSuccess(req);
    const { token, expires } = issueSession();
    reply.setCookie(SESSION_COOKIE, token, sessionCookie(expires));
    // 登记到会话注册表：供「已登录设备」列表展示与单设备下线
    registerSession(token, { ip: clientIp(req), userAgent: req.headers["user-agent"] });
    // 初始密码是系统生成的随机串：登录即证明持有凭据，提示立即换成自己的密码
    return { ok: true, data: { mustChangePassword: isGeneratedPassword() } };
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    // 仅下线当前设备：吊销本会话并清 cookie；全设备下线走「修改密码」
    const token = req.cookies[SESSION_COOKIE];
    if (token && verifySession(token)) {
      revokeSession(sessionIdOf(token));
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // 已登录设备列表（含本机标注），供设置页会话管理展示
  app.get("/api/v1/auth/sessions", async (req) => {
    return { ok: true, data: listSessions(req.cookies[SESSION_COOKIE]) };
  });

  // 单设备下线：吊销指定会话；下线自己时同步清 cookie
  app.delete("/api/v1/auth/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const token = req.cookies[SESSION_COOKIE];
    const ok = revokeSession(id);
    if (!ok) throw new HttpError(404, "会话不存在或已下线");
    if (token && sessionIdOf(token) === id) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
    }
    return { ok: true };
  });

  // 一键下线其他设备：保留当前会话
  app.post("/api/v1/auth/sessions/revoke-others", async (req, reply) => {
    const count = revokeOtherSessions(req.cookies[SESSION_COOKIE]);
    return { ok: true, data: { revoked: count } };
  });

  // 关闭访问锁：吊销全部会话并清除密码（需要当前已登录）。
  // 生产部署（PANEL_AUTH_REQUIRED=true）是部署者的安全承诺，运行时不得静默解除，
  // 直接禁止关闭——需要免密访问时应修改部署配置后重启面板。
  app.delete("/api/v1/auth/password", async (req, reply) => {
    if (authRequired() && !verifySession(req.cookies[SESSION_COOKIE])) {
      throw new HttpError(401, "未登录或会话已过期");
    }
    if (env.authRequired) {
      throw new HttpError(403, "生产部署（PANEL_AUTH_REQUIRED=true）不允许关闭访问锁；如需免密访问请修改部署配置后重启面板");
    }
    clearPassword();
    touchAuthStamp();
    revokeAllSessions();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // 设置/修改密码：已设密码时必须验证旧密码，防止会话被劫持后直接换锁。
  // 例外：初始密码为系统生成的随机串时免验旧密码——用户刚用随机密码登录
  // 已证明持有凭据，要求复述 24 位随机串纯属摩擦、无安全增量；改密后
  // generated 标记清除，后续改密恢复旧密码校验。
  app.put("/api/v1/auth/password", async (req, reply) => {
    const body = (req.body ?? {}) as { oldPassword?: string; newPassword?: string };
    const hadPassword = authRequired();
    if (hadPassword && !verifySession(req.cookies[SESSION_COOKIE])) {
      throw new HttpError(401, "未登录或会话已过期");
    }
    if (hadPassword && !isGeneratedPassword()) {
      if (!body.oldPassword || !verifyPassword(body.oldPassword)) {
        throw new HttpError(401, "旧密码错误");
      }
    }
    const policy = body.newPassword ? passwordPolicyError(body.newPassword) : "密码不能为空";
    if (policy) throw new HttpError(400, policy);
    setPassword(body.newPassword!);
    touchAuthStamp();
    revokeAllSessions(); // 改密后吊销所有旧会话，再为当前用户补发新会话
    const { token, expires } = issueSession();
    reply.setCookie(SESSION_COOKIE, token, sessionCookie(expires));
    return { ok: true };
  });
}
