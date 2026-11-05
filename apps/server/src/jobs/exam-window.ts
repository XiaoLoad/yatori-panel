/** 考试时间窗判定结果 */
export type ExamWindowState = "ok" | "not_started" | "ended";

/**
 * 按平台下发的考试起止时间（RFC3339；空串/缺省 = 平台未给）判定当前是否可考。
 * 时间数据缺失或非法时不拦截（返回 ok），交由平台在开考时裁决——宁可多试不误杀。
 */
export function examWindowState(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now: Date = new Date(),
): ExamWindowState {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return "not_started";
  if (end && !Number.isNaN(end.getTime()) && now > end) return "ended";
  return "ok";
}
