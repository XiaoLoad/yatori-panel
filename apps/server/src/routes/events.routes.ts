import type { FastifyInstance } from "fastify";
import { bus } from "../bus.ts";
import { snapshot } from "../gateway-status.ts";

/** SSE 事件流：面板所有实时数据（进度/日志/状态）都来自这一条长连接 */
export function registerEventRoutes(app: FastifyInstance): void {
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
}
