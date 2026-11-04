import { describe, expect, test } from "bun:test";
import { normalizeBaseUrl } from "../src/url.ts";

describe("normalizeBaseUrl", () => {
  test("英华：丢弃路径/参数/锚点，只保留协议+主机", () => {
    expect(normalizeBaseUrl("https://host.com/user", "YINGHUA")).toBe("https://host.com");
    expect(normalizeBaseUrl("https://host.com/user/login.json", "YINGHUA")).toBe("https://host.com");
    expect(normalizeBaseUrl("https://host.com/a/b?x=1#top", "YINGHUA")).toBe("https://host.com");
  });

  test("英华：保留端口", () => {
    expect(normalizeBaseUrl("https://host.com:8443/user", "YINGHUA")).toBe("https://host.com:8443");
  });

  test("缺少协议时补 https://", () => {
    expect(normalizeBaseUrl("host.com/user", "YINGHUA")).toBe("https://host.com");
    expect(normalizeBaseUrl("host.com", "XUEXITONG")).toBe("https://host.com");
  });

  test("非英华平台：保留路径、去结尾斜杠与参数", () => {
    expect(normalizeBaseUrl("https://host.com/sub/", "XUEXITONG")).toBe("https://host.com/sub");
    expect(normalizeBaseUrl("https://host.com/sub?x=1", "XUEXITONG")).toBe("https://host.com/sub");
  });

  test("空值与异常输入", () => {
    expect(normalizeBaseUrl("", "YINGHUA")).toBe("");
    expect(normalizeBaseUrl("   ", "YINGHUA")).toBe("");
    // URL 解析失败时原样返回，不抛异常
    expect(normalizeBaseUrl("::bad::", "YINGHUA")).toBe("::bad::");
  });
});
