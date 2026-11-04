import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { sqlite } from "./db/index.ts";
import { recoverStaleRunningJobs } from "./db/jobs.ts";
import { authRequired, SESSION_COOKIE, verifySession } from "./db/auth.ts";
import { env } from "./env.ts";
import { gateway } from "./gateway.ts";
import { jobManager } from "./jobs/manager.ts";
import { registerRoutes } from "./routes/index.ts";
import { startScheduler } from "./scheduler.ts";
import { startGatewayWatch } from "./gateway-status.ts";
import { dropAllSessions } from "./sessions.ts";

// 无需会话的接口：健康探针与登录流程自身
const PUBLIC_APIS = new Set([
  "/api/v1/health",
  "/api/v1/auth/status",
  "/api/v1/auth/login",
]);

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: "info" } });

  // CORS 白名单：默认仅同源（单端口部署无需跨域）；跨域需求用 PANEL_CORS_ORIGINS 显式放行，
  // 不再反射任意 Origin，避免恶意站点携带 Cookie 跨站调用 API
  await app.register(cors, {
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    credentials: true,
  });
  await app.register(cookie);

  // API 访问锁：未启用密码时全放行；启用后除公开接口外一律校验会话。
  // 非 /api 路径是 SPA 静态资源，鉴权由前端登录页承接。
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0]!;
    if (!url.startsWith("/api/")) return;
    if (PUBLIC_APIS.has(url)) return;
    if (!authRequired()) return;
    if (!verifySession(req.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({ ok: false, error: "未登录或会话已过期" });
    }
  });

  registerRoutes(app);
  // 启动恢复：上次进程遗留的 running 任务已不可能再结束，标记为中断，
  // 否则账号会永久卡在"运行中"且无法启动新任务
  const interrupted = recoverStaleRunningJobs();
  if (interrupted > 0) {
    app.log.warn(`已将 ${interrupted} 个重启前遗留的运行任务标记为中断`);
  }
  startScheduler();
  // 网关状态机：后台心跳探测，up/down 变化经 SSE 广播（health 接口直接读快照，不再逐次探测）
  startGatewayWatch();

  // 前端构建产物存在时同源托管（生产模式单端口，开发模式走 Vite 代理）
  const indexHtml = path.join(env.webDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: env.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ ok: false, error: "接口不存在" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`未找到前端构建产物（${env.webDist}），仅提供 API`);
  }

  const shutdown = async () => {
    app.log.info("正在关闭：停止任务 → 关闭会话 → 关闭数据库");
    jobManager.stopAll();
    await dropAllSessions();
    await app.close();
    sqlite.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ host: env.host, port: env.port });
  app.log.info(
    `yatori-panel 已启动：http://${env.host}:${env.port}（访问锁：${authRequired() ? "已启用" : "未启用"}）`,
  );
}

main().catch((err) => {
  console.error("启动失败：", err);
  process.exit(1);
});
