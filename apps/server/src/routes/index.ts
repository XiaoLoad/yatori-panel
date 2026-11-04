import type { FastifyInstance } from "fastify";
import { HttpError } from "../errors.ts";
import { GatewayError } from "../gateway.ts";
import { registerAccountRoutes } from "./accounts.routes.ts";
import { registerAuthRoutes } from "./auth.routes.ts";
import { registerBaseRoutes } from "./base.routes.ts";
import { registerCourseRoutes } from "./courses.routes.ts";
import { registerEventRoutes } from "./events.routes.ts";
import { registerJobRoutes } from "./jobs.routes.ts";
import { registerScheduleRoutes } from "./schedules.routes.ts";

export { parse } from "./shared.ts";
export { assertAnswerSourceReady } from "./guards.ts";

/** 按领域聚合注册全部 REST 路由与统一错误处理 */
export function registerRoutes(app: FastifyInstance): void {
  registerBaseRoutes(app);
  registerAuthRoutes(app);
  registerAccountRoutes(app);
  registerCourseRoutes(app);
  registerScheduleRoutes(app);
  registerJobRoutes(app);
  registerEventRoutes(app);

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
