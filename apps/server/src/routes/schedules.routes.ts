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
import { parse } from "./shared.ts";

/** 创建/编辑共用的校验：cron 合法 + 引用的账号都存在 */
function assertScheduleBody(body: CreateScheduleBody): void {
  if (!cron.validate(body.cron)) {
    throw new HttpError(400, "cron 表达式无效");
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
