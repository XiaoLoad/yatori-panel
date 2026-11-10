import { describe, expect, test } from "bun:test";
import type { JobSummary } from "../src/shared.ts";
import { resolveNotifyDecision } from "../src/jobs/notify-policy.ts";

function summary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    courses: 3,
    videosCompleted: 0,
    videosSkipped: 0,
    flagsFound: 0,
    worksDone: 0,
    examsDone: 0,
    scores: [],
    errors: [],
    ...overrides,
  };
}

describe("resolveNotifyDecision", () => {
  test("任务出错 → 失败，必须推送", () => {
    expect(resolveNotifyDecision("error", summary()).state).toBe("failed");
  });

  test("手动停止 → 跳过", () => {
    expect(resolveNotifyDecision("stopped", summary({ videosCompleted: 2 })).state).toBe("skipped");
  });

  test("已完成课程重复运行、无任何产出 → 跳过", () => {
    expect(resolveNotifyDecision("done", summary()).state).toBe("skipped");
  });

  test("只有未解锁/前置锁跳过、没有真实推进 → 跳过", () => {
    expect(resolveNotifyDecision("done", summary({ videosSkipped: 5 })).state).toBe("skipped");
  });

  test("完成视频 → 推送", () => {
    expect(resolveNotifyDecision("done", summary({ videosCompleted: 1 })).state).toBe("completed");
  });

  test("仅考试类课程完成考试 → 推送", () => {
    expect(resolveNotifyDecision("done", summary({ examsDone: 2 })).state).toBe("completed");
  });

  test("有异常但无产出 → 推送，便于排查", () => {
    expect(resolveNotifyDecision("done", summary({ errors: ["课程列表拉取失败"] })).state).toBe(
      "completed",
    );
  });
});
