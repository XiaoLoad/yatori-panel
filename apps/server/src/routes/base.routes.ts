import type { FastifyInstance } from "fastify";
import { sqlite } from "../db/index.ts";
import { listAccounts } from "../db/accounts.ts";
import { getSettings, saveSettings } from "../db/settings.ts";
import { UpdateSettingsBody } from "../shared.ts";
import { gateway } from "../gateway.ts";
import { refreshGatewayStatus, snapshot } from "../gateway-status.ts";
import { listJobs } from "../db/jobs.ts";
import { getSessionId } from "../sessions.ts";
import { parse } from "./shared.ts";

/** 基础与元信息：健康、平台、预检、设置、统计、仪表盘 */
export function registerBaseRoutes(app: FastifyInstance): void {
  // 网关状态由后台心跳维护（gateway-status.ts），这里只读快照；detail 供前端诊断提示
  app.get("/api/v1/health", async () => {
    const s = snapshot();
    return {
      ok: true,
      data: {
        status: "up",
        gateway: s.up ? "up" : "down",
        detail: s.detail,
        downAt: s.downAt,
        upAt: s.upAt,
      },
    };
  });

  // 前端"重新检测"按钮：立即探测而非等下一个心跳周期
  app.post("/api/v1/health/recheck", async () => {
    const s = await refreshGatewayStatus();
    return {
      ok: true,
      data: { status: "up", gateway: s.up ? "up" : "down", detail: s.detail, downAt: s.downAt, upAt: s.upAt },
    };
  });

  app.get("/api/v1/platforms", async () => {
    return { ok: true, data: await gateway.platforms() };
  });

  // AI/题库配置预检代理（设置页测试按钮与发起任务门禁共用）
  app.post("/api/v1/preflight", async (req) => {
    const body = (req.body ?? {}) as Parameters<typeof gateway.preflight>[0];
    return { ok: true, data: await gateway.preflight(body) };
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

  // ---------- 统计 ----------
  app.get("/api/v1/stats/daily", async (req) => {
    const q = req.query as { days?: string };
    const days = Math.min(60, Math.max(7, Number(q.days) || 14));
    const rows = sqlite
      .prepare(
        `SELECT substr(started_at, 1, 10) AS day,
                COUNT(*) AS jobs,
                SUM(CASE WHEN state = 'error' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(CAST(json_extract(summary_json, '$.videosCompleted') AS INTEGER)), 0) AS videos
         FROM jobs
         WHERE started_at >= datetime('now', ?)
         GROUP BY day ORDER BY day`,
      )
      .all(`-${days - 1} days`) as { day: string; jobs: number; errors: number; videos: number }[];
    // 补齐空缺日期，保证图表时间轴连续
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: { day: string; jobs: number; errors: number; videos: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const hit = byDay.get(d);
      out.push({ day: d, jobs: hit?.jobs ?? 0, errors: hit?.errors ?? 0, videos: hit?.videos ?? 0 });
    }
    return { ok: true, data: out };
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
}
