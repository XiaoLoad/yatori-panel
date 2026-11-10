import { env } from "./env.ts";

/**
 * 时区工具：定时规则与"按天"统计统一按 `PANEL_TIMEZONE` 解释墙钟时间。
 *
 * 为什么不能直接用进程本地时间：容器默认 UTC，`setHours(0,0,0,0)`
 * 取到的是 UTC 零点（北京时间 08:00），cron 的"7 点"也会变成 UTC 7 点。
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 指定时区下的墙钟字段 */
export function zonedParts(ts: number, timeZone = env.timezone): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // 个别实现把午夜格式化成 24 点
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** 把「指定时区的墙钟时间」换算成 UTC 时间戳；两轮修正可覆盖夏令时切换 */
export function zonedWallTimeToTs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = env.timezone,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ts, timeZone);
    ts += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return ts;
}

/** 时区相对 UTC 的偏移（分钟）：东八区返回 480 */
export function tzOffsetMinutes(timeZone = env.timezone, at: number = Date.now()): number {
  const p = zonedParts(at, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/** 时区内某天的零点（ISO UTC 串），用于数据库时间比较 */
export function zonedDayStartIso(
  year: number,
  month: number,
  day: number,
  timeZone = env.timezone,
): string {
  return new Date(zonedWallTimeToTs(year, month, day, 0, 0, 0, timeZone)).toISOString();
}

/** 时区内的「今天零点」 */
export function zonedTodayStartIso(timeZone = env.timezone): string {
  const p = zonedParts(Date.now(), timeZone);
  return zonedDayStartIso(p.year, p.month, p.day, timeZone);
}
