import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { CreateScheduleBody } from "../shared.ts";
import { getAccount } from "../db/accounts.ts";
import { deleteSchedule, getSchedule, insertSchedule, listSchedules, setScheduleEnabled } from "../db/schedules.ts";
import { registerSchedule, unregisterSchedule } from "../scheduler.ts";
import { HttpError } from "../errors.ts";
import { parse } from "./shared.ts";

/** 定时任务：列表、创建、启停切换、删除 */
export function registerScheduleRoutes(app: FastifyInstance): void {
  app.get("/api/v1/schedules", async () => {
    return { ok: true, data: listSchedules() };
  });

  app.post("/api/v1/schedules", async (req) => {
    const body = parse<CreateScheduleBody>(req.body, CreateScheduleBody);
    if (!cron.validate(body.cron)) {
      throw new HttpError(400, "cron 表达式无效");
    }
    for (const uid of body.accountUids) {
      if (!getAccount(uid)) throw new HttpError(404, "定时规则包含不存在的账号");
    }
    const job = insertSchedule({
      name: body.name,
      accountUids: body.accountUids,
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
