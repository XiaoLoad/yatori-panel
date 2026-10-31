import cors from "@fastify/cors";
import Fastify from "fastify";
import { sqlite } from "./db/index.ts";
import { env } from "./env.ts";
import { jobManager } from "./jobs/manager.ts";
import { registerRoutes } from "./routes.ts";
import { dropAllSessions } from "./sessions.ts";
import { gateway } from "./gateway.ts";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: "info",
      transport: undefined,
    },
  });

  await app.register(cors, { origin: true });

  registerRoutes(app);

  // 网关预检：不可达只警告不阻断（前端会显示网关状态）
  try {
    await gateway.health();
    app.log.info(`网关在线：${env.gatewayURL}`);
  } catch {
    app.log.warn(`网关不可达（${env.gatewayURL}）——登录/刷课接口将不可用`);
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
  app.log.info(`yatori-panel 后端已启动：http://${env.host}:${env.port}`);
}

main().catch((err) => {
  console.error("启动失败：", err);
  process.exit(1);
});
