import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { CreateScheduleBody } from "../shared.ts";
import { getAccount } from "../db/accounts.ts";
import {
  deleteSchedule,
  getSchedule,
  insertSchedule,
  listSchedules,
  setScheduleEnabled,
  updateSchedule,
} from "../db/schedules.ts";
import { registerSchedule, unregisterSchedule } from "../scheduler.ts";
import { HttpError } from "../errors.ts";
import { zonedParts } from "../timezone.ts";
import { parse } from "./shared.ts";

/** 时区内的今天（YYYY-MM-DD）：一次性规则的时间校验按面板配置时区判断 */
function todayKey(): string {
  const p = zonedParts(Date.now());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 创建/编辑共用的校验：cron 合法 + 引用的账号都存在 */
function assertScheduleBody(body: CreateScheduleBody): void {
  if (!cron.validate(body.cron)) {
    throw new HttpError(400, "cron 表达式无效");
  }
  // 一次性规则不允许设置为过去的日期：当天仍可创建（等当天稍晚执行）
  if (body.repeatMode === "once" && body.runDate && body.runDate < todayKey()) {
    throw new HttpError(400, "执行日期不能早于今天");
  }
  for (const uid of body.accountUids) {
    if (!getAccount(uid)) throw new HttpError(404, "定时规则包含不存在的账号");
  }
}

/** 定时任务：列表、创建、编辑、启停切换、删除 */
export function registerScheduleRoutes(app: FastifyInstance): void {
  app.get("/api/v1/schedules", async () => {
    return { ok: true, data: listSchedules() };
  });

  app.post("/api/v1/schedules", async (req) => {
    const body = parse<CreateScheduleBody>(req.body, CreateScheduleBody);
    assertScheduleBody(body);
    const job = insertSchedule({
      name: body.name,
      scope: body.scope,
      accountUids: body.accountUids,
      courseIds: body.courseIds,
      cron: body.cron,
      repeatMode: body.repeatMode,
      runDate: body.runDate,
      endTime: body.endTime,
      stopMode: body.stopMode,
      videoMode: body.videoMode,
      answerSource: body.answerSource,
      submitMode: body.submitMode,
    });
    registerSchedule(job);
    return { ok: true, data: job };
  });

  app.put("/api/v1/schedules/:id", async (req) => {
    const { id } = req.params as { id: string };
    if (!getSchedule(id)) throw new HttpError(404, "定时任务不存在");
    const body = parse<CreateScheduleBody>(req.body, CreateScheduleBody);
    assertScheduleBody(body);
    const updated = updateSchedule(id, {
      name: body.name,
      scope: body.scope,
      accountUids: body.accountUids,
      courseIds: body.courseIds,
      cron: body.cron,
      repeatMode: body.repeatMode,
      runDate: body.runDate,
      endTime: body.endTime,
      stopMode: body.stopMode,
      videoMode: body.videoMode,
      answerSource: body.answerSource,
      submitMode: body.submitMode,
    });
    if (!updated) throw new HttpError(404, "定时任务不存在");
    // 编辑不影响启用状态与"上次运行"；安全重注册会接管当天已启动任务的到点停止
    registerSchedule(updated);
    return { ok: true, data: updated };
  });

  app.post("/api/v1/schedules/:id/toggle", async (req) => {
    const schedule = getSchedule((req.params as { id: string }).id);
    if (!schedule) throw new HttpError(404, "定时任务不存在");
    const enabled = !schedule.enabled;
    setScheduleEnabled(schedule.id, enabled);
    if (enabled) registerSchedule({ ...schedule, enabled: true });
    else unregisterSchedule(schedule.id);
    return { ok: true, data: { enabled } };
  });

  app.delete("/api/v1/schedules/:id", async (req) => {
    const { id } = req.params as { id: string };
    unregisterSchedule(id);
    deleteSchedule(id);
    return { ok: true };
  });
}
