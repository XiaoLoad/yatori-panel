import type { JobEvent, JobState, JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";

export type AccountStatus = "running" | "online" | "error" | "idle";

/** 账号状态：运行中优先，其次登录异常，最后按是否持有会话区分在线/待登录 */
export function accountStatus(a: AccountWithSession, runningJob?: JobVO | null): AccountStatus {
  if (runningJob) return "running";
  if (a.lastVerifyOk === 0 || a.sessionState === "error") return "error";
  if (a.hasSession) return "online";
  return "idle";
}

export function statusMeta(status: AccountStatus): {
  label: string;
  dot: string;
  text: string;
} {
  switch (status) {
    case "running":
      return { label: "运行中", dot: "bg-primary", text: "text-primary" };
    case "online":
      return { label: "在线", dot: "bg-mint", text: "text-mint" };
    case "error":
      return { label: "异常", dot: "bg-coral", text: "text-coral" };
    default:
      return { label: "待登录", dot: "bg-muted-foreground/60", text: "text-muted-foreground" };
  }
}

export function phaseLabel(progress?: JobEvent | null, running = false): string {
  const map = { login: "登录", video: "视频", work: "作业", exam: "考试" } as const;
  if (progress?.phase) return map[progress.phase];
  return running ? "进行中" : "待机";
}

export function phaseTone(progress?: JobEvent | null): "mint" | "amber" | "ice" | "muted" {
  switch (progress?.phase) {
    case "video":
      return "mint";
    case "work":
      return "amber";
    case "exam":
      return "ice";
    default:
      return "muted";
  }
}

export function jobStateLabel(state?: JobState): string {
  if (!state) return "";
  return { running: "运行中", done: "已完成", stopped: "已停止", error: "出错" }[state];
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** cron 前两位是「分 时」，用于展示定时窗口 */
export function scheduleWindow(s?: ScheduleVO | null): { time: string; name: string } | null {
  if (!s) return null;
  const parts = s.cron.trim().split(/\s+/);
  const start =
    parts.length >= 2 ? `${parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}` : s.cron;
  // 一次性规则：显示日期，不带日期的「开始时间」会被误读成每天执行
  if (s.repeatMode === "once") {
    const date = s.runDate ? s.runDate.slice(5).replace("-", "/") : "未设日期";
    return {
      name: s.name || "定时规则",
      time: s.endTime ? `${date} ${start} → ${s.endTime}` : `${date} ${start}`,
    };
  }
  return {
    name: s.name || "定时规则",
    time: s.endTime ? `${start} → ${s.endTime}` : `${start} 开始`,
  };
}

/** 进度事件里课程/节点组合，供列表与卡片复用 */
export function progressDetail(progress?: JobEvent | null): string {
  if (!progress) return "";
  return [progress.courseName, progress.nodeName].filter(Boolean).join(" · ");
}

/** 任务整体课程进度（按视频总时长计算），没有统计值时返回 null */
export function overallPercent(progress?: JobEvent | null): number | null {
  const total = progress?.courseTotalSeconds ?? 0;
  if (total <= 0) return null;
  const remaining = Math.max(0, progress?.courseRemainingSeconds ?? 0);
  return Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100)));
}

/** 预计剩余时长，用于“还有多久刷完”的展示 */
export function formatEta(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "不到 1 分钟";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h <= 0) return `${m} 分钟`;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
