import type { FastifyInstance, FastifyRequest } from "fastify";
import "@fastify/cookie";
import {
  authRequired,
  issueSession,
  isGeneratedPassword,
  passwordPolicyError,
  revokeAllSessions,
  SESSION_COOKIE,
  clearPassword,
  setPassword,
  touchAuthStamp,
  verifyPassword,
  verifySession,
} from "../db/auth.ts";
import { env } from "../env.ts";
import { HttpError } from "../errors.ts";

// ---------- 登录防爆破（内存级，单机部署足够） ----------
// 同一 IP 连续失败 MAX_FAILURES 次后锁定 LOCKOUT_MS；成功登录即清零。
// 进程重启计数清零：重启本身就中断了爆破节奏，内存方案换取零外部依赖。
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface FailureRecord {
  count: number;
  lockedUntil: number;
}

const failures = new Map<string, FailureRecord>();

function clientIp(req: FastifyRequest): string {
  // trustProxy 开启时 Fastify 已解析 X-Forwarded-For；否则直连取 socket 地址
  return req.ip || "unknown";
}

function loginGate(req: FastifyRequest): void {
  const rec = failures.get(clientIp(req));
  if (rec && rec.lockedUntil > Date.now()) {
    const minutes = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
    throw new HttpError(429, `失败次数过多，请 ${minutes} 分钟后重试`);
  }
}

function recordLoginFailure(req: FastifyRequest): void {
  const ip = clientIp(req);
  const rec = failures.get(ip) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  failures.set(ip, rec);
}

function recordLoginSuccess(req: FastifyRequest): void {
  failures.delete(clientIp(req));
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
    // 初始密码是系统生成的随机串：登录即证明持有凭据，提示立即换成自己的密码
    return { ok: true, data: { mustChangePassword: isGeneratedPassword() } };
  });

  app.post("/api/v1/auth/logout", async (_req, reply) => {
    revokeAllSessions();
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
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
