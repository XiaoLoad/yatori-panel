import type { FastifyInstance } from "fastify";
import { sqlite } from "../db/index.ts";
import { listAccounts } from "../db/accounts.ts";
import { getSettings, saveSettings } from "../db/settings.ts";
import { UpdateSettingsBody, EmailTestBody } from "../shared.ts";
import { HttpError } from "../errors.ts";
import { sendTestMail } from "../mailer.ts";
import { gateway } from "../gateway.ts";
import { refreshGatewayStatus, snapshot } from "../gateway-status.ts";
import { failureBreakdown, listJobs } from "../db/jobs.ts";
import { getSessionId } from "../sessions.ts";
import { env } from "../env.ts";
import { tzOffsetMinutes, zonedDayStartIso, zonedParts } from "../timezone.ts";
import { parse } from "./shared.ts";

/** 基础与元信息：健康、平台、预检、设置、统计、仪表盘 */
export function registerBaseRoutes(app: FastifyInstance): void {
  // 网关状态由后台心跳维护（gateway-status.ts），这里只读快照；detail 供前端诊断提示
  // 注意：无论网关是否在线，面板本身均返回 200——容器健康检查只关心面板进程存活
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
        /** 定时规则解释时区：前端据此提示「几点几分」按哪个时区执行 */
        timezone: env.timezone,
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

  // 邮箱通知测试发送：使用表单当前值（未保存也可测），以样例数据渲染真实模板
  app.post("/api/v1/settings/email/test", async (req) => {
    const { email } = parse<EmailTestBody>(req.body, EmailTestBody);
    if (!email.smtpHost.trim()) throw new HttpError(400, "请先填写 SMTP 服务器");
    if (!email.user.trim()) throw new HttpError(400, "请先填写发件账号");
    if (!email.pass) throw new HttpError(400, "请先填写发件密码/授权码");
    if (!email.to.trim()) throw new HttpError(400, "请先填写收件人");
    const to = await sendTestMail(email);
    return { ok: true, data: { message: `测试邮件已发送至 ${to}，请查收` } };
  });

  // ---------- 统计 ----------
  // 按天聚合必须用配置时区的日历日：started_at 存的是 UTC ISO，
  // 直接 substr 会把「北京时间凌晨 0-8 点」的任务算进前一天。
  app.get("/api/v1/stats/daily", async (req) => {
    const q = req.query as { days?: string };
    const days = Math.min(60, Math.max(7, Number(q.days) || 14));
    const offset = tzOffsetMinutes();
    // SQLite 的 date() 修饰符：把 UTC 时间整体平移到目标时区再取日期
    const shift = `${offset >= 0 ? "+" : "-"}${Math.abs(offset)} minutes`;
    const today = zonedParts(Date.now());
    // 时间轴：时区内连续 days 天（含今天）
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dayKeys.push(new Date(Date.UTC(today.year, today.month - 1, today.day - i)).toISOString().slice(0, 10));
    }
    const first = dayKeys[0]!.split("-").map(Number);
    const since = zonedDayStartIso(first[0]!, first[1]!, first[2]!);
    const rows = sqlite
      .prepare(
        `SELECT date(started_at, ?) AS day,
                COUNT(*) AS jobs,
                SUM(CASE WHEN state = 'error' THEN 1 ELSE 0 END) AS errors,
                COALESCE(SUM(videos_completed), 0) AS videos
         FROM jobs
         WHERE started_at >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(shift, since) as { day: string; jobs: number; errors: number; videos: number }[];
    // 补齐空缺日期，保证图表时间轴连续
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out = dayKeys.map((day) => {
      const hit = byDay.get(day);
      return { day, jobs: hit?.jobs ?? 0, errors: hit?.errors ?? 0, videos: hit?.videos ?? 0 };
    });
    return { ok: true, data: out };
  });

  // ---------- 失败原因看板 ----------
  app.get("/api/v1/stats/failures", async (req) => {
    const q = req.query as { days?: string };
    const days = Math.min(90, Math.max(1, Number(q.days) || 14));
    return { ok: true, data: failureBreakdown(days) };
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
