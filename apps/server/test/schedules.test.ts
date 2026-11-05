import { describe, expect, test } from "bun:test";
import { CreateScheduleBody, startMinutesOfCron } from "../src/shared.ts";

/** 组一个合法的创建入参，个别字段按用例覆盖 */
function base(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: "测试规则",
    accountUids: ["uid-1"],
    cron: "30 20 * * 1-5",
    stopMode: "finish_current",
    videoMode: 1,
    answerSource: "off",
    submitMode: "off",
    ...over,
  };
}

describe("startMinutesOfCron", () => {
  test("纯数字分/时字段可提取", () => {
    expect(startMinutesOfCron("30 20 * * 1-5")).toBe(20 * 60 + 30);
    expect(startMinutesOfCron("  0  0 * * * ")).toBe(0);
  });

  test("含通配/步进字段时返回 null（无法确定唯一开始时刻）", () => {
    expect(startMinutesOfCron("*/10 9 * * *")).toBeNull();
    expect(startMinutesOfCron("30 * * * *")).toBeNull();
    expect(startMinutesOfCron("30 20")).toBeNull();
  });
});

describe("CreateScheduleBody 结束时间校验", () => {
  test("结束晚于开始：通过", () => {
    const r = CreateScheduleBody.safeParse(base({ endTime: "22:30" }));
    expect(r.success).toBe(true);
  });

  test("不填结束时间：通过（不自动停止）", () => {
    const r = CreateScheduleBody.safeParse(base());
    expect(r.success).toBe(true);
  });

  test("结束早于开始：拒绝并指向 endTime 字段", () => {
    const r = CreateScheduleBody.safeParse(base({ cron: "0 23 * * *", endTime: "01:00" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("endTime"));
      expect(issue?.message).toContain("结束时间必须晚于开始时间");
    }
  });

  test("结束等于开始：拒绝（避免刚启动即被停止）", () => {
    const r = CreateScheduleBody.safeParse(base({ endTime: "20:30" }));
    expect(r.success).toBe(false);
  });

  test("cron 分钟字段为步进时跳过先后比较", () => {
    const r = CreateScheduleBody.safeParse(base({ cron: "*/10 9 * * *", endTime: "08:00" }));
    expect(r.success).toBe(true);
  });
});

describe("CreateScheduleBody 作用域校验", () => {
  test("指定账号作用域：名单为空拒绝", () => {
    const r = CreateScheduleBody.safeParse(base({ accountUids: [] }));
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("accountUids"));
      expect(issue?.message).toContain("请至少选择一个账号");
    }
  });

  test("全部账号作用域：不需要名单", () => {
    const r = CreateScheduleBody.safeParse(base({ scope: "all", accountUids: [] }));
    expect(r.success).toBe(true);
  });

  test("缺省作用域视为指定账号", () => {
    const r = CreateScheduleBody.safeParse(base());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scope).toBeUndefined();
  });
});
