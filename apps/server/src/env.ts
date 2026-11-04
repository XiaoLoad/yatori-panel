import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src → 仓库根
export const repoRoot = path.resolve(here, "..", "..", "..");

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  dataDir: process.env.PANEL_DATA_DIR ?? path.join(repoRoot, "data"),
  webDist: process.env.WEB_DIST ?? path.join(repoRoot, "apps", "web", "dist"),
  corsOrigins: origins(process.env.PANEL_CORS_ORIGINS),
  /** 账号密码加密密钥：优先环境变量注入，与数据目录分离，避免备份即泄露 */
  secretKey: process.env.PANEL_SECRET_KEY,
};
