import type { JobSummary } from "../shared.ts";

/**
 * 邮件推送状态（与任务状态解耦）：
 * - failed    任务出错，必须推送；
 * - completed 任务完成且存在实际产出（或存在异常需要告知），推送；
 * - skipped   手动停止，或完成后没有任何实际产出，静默跳过。
 */
export type NotifyState = "failed" | "completed" | "skipped";

export interface NotifyDecision {
  state: NotifyState;
  reason: string;
}

/** 本次任务是否产生了真实推进（跳过/未解锁的视频不算产出） */
export function hasActualOutput(summary: JobSummary): boolean {
  return (
    summary.videosCompleted > 0 ||
    summary.worksDone > 0 ||
    summary.examsDone > 0 ||
    summary.flagsFound > 0
  );
}

/**
 * 推送判定：
 * - 失败：始终推送，便于及时处理；
 * - 完成：有视频/作业/考试/标红产出，或虽有异常但需要用户知晓时推送；
 * - 跳过：手动停止、以及「仅检查已完成课程 / 仅剩已考过的考试」这类无产出的重复执行，
 *   避免定时任务每天空跑都发一封邮件。
 */
export function resolveNotifyDecision(
  jobState: string,
  summary: JobSummary,
): NotifyDecision {
  if (jobState === "error") {
    return { state: "failed", reason: "任务执行出错" };
  }
  if (jobState !== "done") {
    return { state: "skipped", reason: "任务已手动停止" };
  }
  if (summary.errors.length > 0) {
    return { state: "completed", reason: "任务完成但存在异常" };
  }
  if (!hasActualOutput(summary)) {
    return { state: "skipped", reason: "本次任务没有实际产出" };
  }
  return { state: "completed", reason: "任务完成且有实际产出" };
}
