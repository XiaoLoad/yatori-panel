import { describe, expect, test } from "bun:test";
import { accountDisplayLabel, siteTagOf, siteTagsFor } from "../src/shared.ts";

describe("siteTagOf", () => {
  test("取域名首段", () => {
    expect(siteTagOf("https://cqcst.tuozhikj.com/")).toBe("cqcst");
    expect(siteTagOf("https://xxgxy.tuozhikj.com/user/login")).toBe("xxgxy");
  });

  test("无有效地址返回空串", () => {
    expect(siteTagOf("")).toBe("");
    expect(siteTagOf(undefined)).toBe("");
    expect(siteTagOf(null)).toBe("");
    expect(siteTagOf("not a url")).toBe("");
  });
});

describe("siteTagsFor", () => {
  const base = { platform: "YINGHUA", username: "2026305955" };

  test("无跨站点歧义：不产生标签", () => {
    const m = siteTagsFor([
      { uid: "a", ...base, baseUrl: "https://cqcst.tuozhikj.com" },
    ]);
    expect(m.size).toBe(0);
  });

  test("同学号两个站点：各自产生短标签", () => {
    const m = siteTagsFor([
      { uid: "a", ...base, baseUrl: "https://cqcst.tuozhikj.com" },
      { uid: "b", ...base, baseUrl: "https://xxgxy.tuozhikj.com" },
    ]);
    expect(m.get("a")).toBe("cqcst");
    expect(m.get("b")).toBe("xxgxy");
  });

  test("不同学号同名不构成歧义", () => {
    const m = siteTagsFor([
      { uid: "a", ...base, username: "2026305955", baseUrl: "https://cqcst.tuozhikj.com" },
      { uid: "b", ...base, username: "2026304679", baseUrl: "https://xxgxy.tuozhikj.com" },
    ]);
    expect(m.size).toBe(0);
  });

  test("短标签撞车：整组回退完整域名", () => {
    const m = siteTagsFor([
      { uid: "a", ...base, baseUrl: "https://cqcst.site-a.com" },
      { uid: "b", ...base, baseUrl: "https://cqcst.site-b.com" },
    ]);
    expect(m.get("a")).toBe("cqcst.site-a.com");
    expect(m.get("b")).toBe("cqcst.site-b.com");
  });

  test("不同平台的同名账号互不干扰", () => {
    const m = siteTagsFor([
      { uid: "a", platform: "YINGHUA", username: "2026305955", baseUrl: "https://cqcst.tuozhikj.com" },
      { uid: "b", platform: "XUEXITONG", username: "2026305955", baseUrl: "https://www.chaoxing.com" },
    ]);
    expect(m.size).toBe(0);
  });
});

describe("accountDisplayLabel", () => {
  test("优先备注，缺省学号", () => {
    expect(accountDisplayLabel({ remark: "欧亚军", username: "2026305955" })).toBe("欧亚军");
    expect(accountDisplayLabel({ remark: "", username: "2026305955" })).toBe("2026305955");
  });

  test("歧义时追加站点标签", () => {
    expect(accountDisplayLabel({ remark: "欧亚军", username: "2026305955" }, "cqcst")).toBe("欧亚军 · cqcst");
  });
});
