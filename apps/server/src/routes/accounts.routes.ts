import type { FastifyInstance } from "fastify";
import { parse as parseYaml } from "yaml";
import {
  countAccountsByPlatform,
  deleteAccount,
  getAccount,
  insertAccount,
  listAccounts,
  markVerify,
  updateAccount,
} from "../db/accounts.ts";
import { gateway } from "../gateway.ts";
import { HttpError } from "../errors.ts";
import { dropSession, ensureSession, getSessionId, getSessionState } from "../sessions.ts";
import { jobManager } from "../jobs/manager.ts";
import { parse } from "./shared.ts";
import { CreateAccountBody, UpdateAccountBody } from "../shared.ts";

/** 部分平台账号未填 baseUrl 时的默认网页入口 */
const PLATFORM_ENTRY: Record<string, string> = {
  XUEXITONG: "https://www.chaoxing.com",
};

/** 平台别名归一（对齐 core 的 platformAliases 子集） */
const PLATFORM_ALIAS: Record<string, string> = {
  YINGHUA: "YINGHUA", XUEXITONG: "XUEXITONG", XXT: "XUEXITONG", CHAOXING: "XUEXITONG",
  ICVE: "ICVE", ZJY: "ICVE", CQIE: "CQIE", ENAAE: "ENAAE", WELEARN: "WELEARN",
  QSXT: "QSXT", QINGSHUXUETANG: "QSXT", TTCDW: "TTCDW", KETANGX: "KETANGX",
  ZXCPKS: "ZXCPKS", HAIQIKEJI: "ZXCPKS", WEIBAN: "WEIBAN", ZHIHUISHU: "ZHIHUISHU", GONGXUE: "GONGXUE",
};

/** 账号：列表、增删改、登录检测、凭据读取、批量导入 */
export function registerAccountRoutes(app: FastifyInstance): void {
  // 备注为空时用平台上的真实姓名自动补全（当前英华支持），失败静默跳过
  async function autoFillRemark(uid: string, currentRemark: string, sid: string): Promise<string> {
    if (currentRemark) return currentRemark;
    try {
      const profile = await gateway.profile(sid);
      if (profile.name) {
        updateAccount(uid, { remark: profile.name });
        return profile.name;
      }
    } catch {
      /* 平台不支持或页面结构变化：不影响主流程 */
    }
    return currentRemark;
  }

  app.get("/api/v1/accounts", async () => {
    const accounts = listAccounts();
    return {
      ok: true,
      data: accounts.map((a) => ({
        ...a,
        hasSession: !!getSessionId(a.uid),
        sessionState: getSessionState(a.uid),
      })),
    };
  });

  app.post("/api/v1/accounts", async (req) => {
    const body = parse<CreateAccountBody>(req.body, CreateAccountBody);
    if (
      countAccountsByPlatform(body.platform, body.baseUrl, body.username) > 0
    ) {
      throw new HttpError(409, "该账号已存在");
    }
    const account = insertAccount({
      platform: body.platform,
      baseUrl: body.baseUrl,
      username: body.username,
      password: body.password,
      remark: body.remark,
      proxyUrl: body.proxyUrl ?? "",
    });

    if (body.verify) {
      try {
        const sid = await ensureSession({ ...account, password: body.password });
        const courses = await gateway.courses(sid);
        markVerify(account.uid, true);
        const remark = await autoFillRemark(account.uid, account.remark, sid);
        return {
          ok: true,
          data: {
            ...account,
            remark,
            verify: { ok: true, courseCount: courses.length },
          },
        };
      } catch (err) {
        const e = err as HttpError;
        markVerify(account.uid, false);
        await dropSession(account.uid);
        return {
          ok: false,
          error: e.message,
          logs: e.logs,
          data: { ...account, verify: { ok: false } },
        };
      }
    }
    return { ok: true, data: account };
  });

  app.post("/api/v1/accounts/:uid/verify", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    try {
      const sid = await ensureSession(account);
      const courses = await gateway.courses(sid);
      markVerify(account.uid, true);
      const remark = await autoFillRemark(account.uid, account.remark, sid);
      return { ok: true, data: { ok: true, courseCount: courses.length, remark } };
    } catch (err) {
      const e = err as HttpError;
      markVerify(account.uid, false);
      await dropSession(account.uid);
      return { ok: false, error: e.message, logs: e.logs, data: { ok: false } };
    }
  });

  // 账号登录信息：用于“打开平台并复制账号密码”，密码仅在按需请求时返回
  app.get("/api/v1/accounts/:uid/credentials", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const entryUrl = account.baseUrl || PLATFORM_ENTRY[account.platform] || "";
    return {
      ok: true,
      data: { username: account.username, password: account.password, entryUrl },
    };
  });

  app.put("/api/v1/accounts/:uid", async (req) => {
    const { uid } = req.params as { uid: string };
    const body = parse<UpdateAccountBody>(req.body, UpdateAccountBody);
    if (!getAccount(uid)) throw new HttpError(404, "账号不存在");
    updateAccount(uid, body);
    await dropSession(uid); // 凭据可能变了，强制下次重建会话
    return { ok: true };
  });

  app.delete("/api/v1/accounts/:uid", async (req) => {
    const { uid } = req.params as { uid: string };
    jobManager.stopByAccount(uid);
    await dropSession(uid);
    deleteAccount(uid);
    return { ok: true };
  });

  // config.yaml 批量导入（对齐 console 的配置结构）
  app.post("/api/v1/accounts/import", async (req) => {
    const body = (req.body ?? {}) as { yaml?: string };
    if (!body.yaml?.trim()) throw new HttpError(400, "请提供 config.yaml 内容");
    if (body.yaml.length > 512 * 1024) throw new HttpError(400, "文件过大");

    let parsed: {
      users?: {
        accountType?: string;
        url?: string;
        account?: string;
        password?: string;
        remarkName?: string;
      }[];
    };
    try {
      parsed = parseYaml(body.yaml);
    } catch (err) {
      throw new HttpError(400, `YAML 解析失败：${(err as Error).message}`);
    }
    const users = parsed.users ?? [];
    if (!users.length) throw new HttpError(400, "config.yaml 中没有 users 配置");

    const result = { imported: 0, skipped: 0, failed: [] as { account: string; error: string }[] };
    for (const u of users) {
      const rawType = (u.accountType ?? "").trim();
      const platform = PLATFORM_ALIAS[rawType.toUpperCase()];
      const username = (u.account ?? "").trim();
      const password = (u.password ?? "").trim();
      if (!platform || !username || !password) {
        result.failed.push({ account: username || "(空)", error: "缺少平台/账号/密码字段" });
        continue;
      }
      try {
        insertAccount({
          platform,
          baseUrl: (u.url ?? "").trim(),
          username,
          password,
          remark: (u.remarkName ?? "").trim(),
        });
        result.imported += 1;
      } catch (err) {
        result.failed.push({ account: username, error: (err as Error).message });
      }
    }
    return { ok: true, data: result };
  });
}
