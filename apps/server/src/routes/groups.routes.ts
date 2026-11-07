import type { FastifyInstance } from "fastify";
import { getAccount } from "../db/accounts.ts";
import { deleteGroup, insertGroup, listGroups, updateGroup } from "../db/groups.ts";
import { HttpError } from "../errors.ts";
import { parse } from "./shared.ts";
import { CreateAccountGroupBody, UpdateAccountGroupBody } from "../shared.ts";

/** 校验组内 uid 全部指向真实账号，防止脏数据混入（导入/前端残留等） */
function assertUidsExist(accountUids: string[]): void {
  for (const uid of accountUids) {
    if (!getAccount(uid)) throw new HttpError(400, `组内包含不存在的账号：${uid.slice(0, 8)}`);
  }
}

/** 账号分组：跨设备同步的自定义分组 CRUD（删除分组不影响账号本身） */
export function registerGroupRoutes(app: FastifyInstance): void {
  app.get("/api/v1/account-groups", async () => {
    return { ok: true, data: listGroups() };
  });

  app.post("/api/v1/account-groups", async (req) => {
    const body = parse(req.body, CreateAccountGroupBody);
    assertUidsExist(body.accountUids);
    return { ok: true, data: insertGroup(body.name, body.accountUids) };
  });

  app.put("/api/v1/account-groups/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(req.body, UpdateAccountGroupBody);
    assertUidsExist(body.accountUids ?? []);
    const updated = updateGroup(id, body);
    if (!updated) throw new HttpError(404, "分组不存在");
    return { ok: true, data: updated };
  });

  app.delete("/api/v1/account-groups/:id", async (req) => {
    const { id } = req.params as { id: string };
    if (!deleteGroup(id)) throw new HttpError(404, "分组不存在");
    return { ok: true };
  });
}
