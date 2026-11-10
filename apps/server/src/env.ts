import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src → 仓库根
export const repoRoot = path.resolve(here, "..", "..", "..");

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

/**
 * 定时规则的时区：cron 按此时区解释「几点几分」，日历边界（当天恢复、结束判定）也用它。
 * 容器默认 UTC，不显式指定会导致「设 7:30 实际 15:30」；非法值回退默认并保证进程能启动。
 */
function timeZone(v: string | undefined): string {
  const fallback = "Asia/Shanghai";
  const tz = (v ?? "").trim() || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.warn(`[env] 无效的 PANEL_TIMEZONE=${tz}，回退 ${fallback}`);
    return fallback;
  }
}

/**
 * CORS 白名单：默认为空 = 仅同源（浏览器同源请求不触发 CORS，
 * 生产单端口部署无需跨域）。开发模式下 Vite 代理也走同源，不受影响。
 * 需要跨域访问 API 时通过 PANEL_CORS_ORIGINS 配置，逗号分隔。
 */
function origins(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  host: process.env.PANEL_HOST ?? "127.0.0.1",
  port: int(process.env.PANEL_PORT, 8080),
  gatewayURL: process.env.GATEWAY_URL ?? "http://127.0.0.1:9801",
  /** 面板 ↔ 网关共享密钥；为空时网关不校验（仅本地回环部署可留空） */
  gatewayToken: process.env.GATEWAY_TOKEN ?? "",
  dataDir: process.env.PANEL_DATA_DIR ?? path.join(repoRoot, "data"),
  webDist: process.env.WEB_DIST ?? path.join(repoRoot, "apps", "web", "dist"),
  corsOrigins: origins(process.env.PANEL_CORS_ORIGINS),
  /** 账号密码加密密钥：优先环境变量注入，与数据目录分离，避免备份即泄露 */
  secretKey: process.env.PANEL_SECRET_KEY,
  /**
   * 强制访问锁：线上部署设置 PANEL_AUTH_REQUIRED=true 后，
   * 数据库无密码时启动会自动生成随机密码并打印到日志，杜绝"忘设密码裸奔上线"。
   * 本地部署（默认）不设置，行为与原来一致。
   */
  authRequired: bool(process.env.PANEL_AUTH_REQUIRED),
  /**
   * 会话 cookie 的 secure 标志：仅 HTTPS 部署时开启。
   * HTTP 部署（含反代终止 TLS 后回源 HTTP）必须保持 false，否则浏览器拒绝回传 cookie。
   */
  cookieSecure: bool(process.env.PANEL_COOKIE_SECURE),
  /** 反代部署时开启，Fastify 信任 X-Forwarded-* 头，登录限速能取到真实客户端 IP */
  trustProxy: bool(process.env.PANEL_TRUST_PROXY),
  /** 会话有效期（小时），默认 24h，本地长期使用可调大 */
  sessionTtlHours: int(process.env.PANEL_SESSION_TTL_HOURS, 24),
  /** 定时规则解释时区：cron 与日历边界共用，默认东八区 */
  timezone: timeZone(process.env.PANEL_TIMEZONE),
};
