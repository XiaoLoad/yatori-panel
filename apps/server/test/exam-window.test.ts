import { describe, expect, test } from "bun:test";
import { examWindowState } from "../src/jobs/exam-window.ts";

// 固定"当前时间"：2026-11-06 12:00 本地时区
const NOW = new Date("2026-11-06T12:00:00");

describe("examWindowState", () => {
  test("开始时间未到 → not_started", () => {
    expect(examWindowState("2026-12-02T19:00:00", "2026-12-09T19:00:00", NOW)).toBe("not_started");
  });

  test("已过结束时间 → ended", () => {
    expect(examWindowState("2026-10-01T09:00:00", "2026-10-20T17:00:00", NOW)).toBe("ended");
  });

  test("窗口内 → ok", () => {
    expect(examWindowState("2026-11-01T09:00:00", "2026-12-31T17:00:00", NOW)).toBe("ok");
  });

  test("只有开始时间且已过 → ok", () => {
    expect(examWindowState("2026-11-01T09:00:00", undefined, NOW)).toBe("ok");
  });

  test("只有结束时间且未到 → ok", () => {
    expect(examWindowState(undefined, "2026-12-31T17:00:00", NOW)).toBe("ok");
  });

  test("平台未给时间 → ok（不拦截，交由平台裁决）", () => {
    expect(examWindowState(undefined, undefined, NOW)).toBe("ok");
    expect(examWindowState("", "", NOW)).toBe("ok");
    expect(examWindowState(null, null, NOW)).toBe("ok");
  });

  test("非法时间串 → ok（宁可多试不误杀）", () => {
    expect(examWindowState("not-a-date", "2026-12-31T17:00:00", NOW)).toBe("ok");
    expect(examWindowState("2026-11-01T09:00:00", "garbage", NOW)).toBe("ok");
  });
});
