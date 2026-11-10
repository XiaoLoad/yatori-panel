import type {
  JobSummary,
  JobSummaryCourseResult,
  JobSummaryCourseState,
} from "./shared.ts";
import { zonedParts } from "./timezone.ts";

/**
 * 任务报告邮件模板（纯渲染，不依赖数据库与 SMTP）。
 * 采用 table + 内联样式布局，兼顾 QQ 邮箱 / Gmail / Outlook 渲染；
 * 页面文案全部使用中文，不加载外部字体与图片。
 */

export interface MailAccount {
  username: string;
  remark: string;
  siteTag?: string;
}

export interface CompletionMailOptions {
  account: MailAccount;
  state: string;
  summary: JobSummary;
  startedAt: string;
  finishedAt: string;
}

interface StatusMeta {
  label: string;
  verb: string;
  color: string;
  bg: string;
  desc: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  done: {
    label: "已完成",
    verb: "任务已完成",
    color: "#0c6b47",
    bg: "#e3f1ea",
    desc: "全部计划内容已推进完毕，以下为本次产出明细。",
  },
  error: {
    label: "出错",
    verb: "任务出错",
    color: "#b3261e",
    bg: "#f9e8e5",
    desc: "任务在执行过程中出现错误并提前结束，请查看下方异常明细。",
  },
  stopped: {
    label: "已停止",
    verb: "任务已停止",
    color: "#57534e",
    bg: "#edeadf",
    desc: "任务已被手动停止，以下为停止前的产出明细。",
  },
};

interface CourseStateMeta {
  label: string;
  color: string;
  bar: string;
  bg: string;
}

const COURSE_STATE_META: Record<JobSummaryCourseState, CourseStateMeta> = {
  completed: { label: "已完成", color: "#0c6b47", bar: "#0c6b47", bg: "#e3f1ea" },
  in_progress: { label: "进行中", color: "#43606f", bar: "#6b8b9c", bg: "#e9eef1" },
  locked: { label: "未解锁", color: "#9a6212", bar: "#d19a3e", bg: "#f7eeda" },
  pending: { label: "未开始", color: "#8a8578", bar: "#c9c3b4", bg: "#efece3" },
};

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Courier New',monospace";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 按面板配置时区展示时间，避免容器 UTC 导致邮件时间偏移 8 小时 */
function fmtTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const p = zonedParts(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 耗时文案：1 小时 23 分 / 45 分钟 / 不足 1 分钟 */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "不足 1 分钟";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 秒 → 视频总长文案：1:23:45 / 23:45 */
function fmtClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 长课程名截断：极端长度先硬截断，避免个别邮件客户端不识别省略号时撑破布局 */
function shortName(name: string, max = 30): string {
  const chars = [...name];
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("")}…`;
}

/** 账号展示：名称 · 学号（无备注时只显示学号）；同学号多站点时追加站点标签 */
function accountLabel(account: MailAccount): string {
  const name = account.remark?.trim();
  const uid = account.username?.trim();
  const site = account.siteTag?.trim()
    ? `<span style="color:#9a9484;"> · 站点 ${esc(account.siteTag.trim())}</span>`
    : "";
  if (name && uid) return `${esc(name)}${site}<span style="color:#9a9484;"> · 学号 ${esc(uid)}</span>`;
  return `${esc(uid || name || "未知账号")}${site}`;
}

/** 统计格：大号数字 + 中文标签 */
function statCell(
  value: number | string,
  label: string,
  opts: { right?: boolean; accent?: boolean } = {},
): string {
  const color = opts.accent && Number(value) > 0 ? "#b3261e" : "#1f2a2e";
  const padding = opts.right ? "14px 0 12px 18px" : "14px 18px 12px 0";
  return `<td width="50%" valign="top" style="padding:${padding};border-top:1px solid #e4e0d5;">
    <div style="font:600 21px/1 ${MONO};color:${color};">${esc(String(value))}</div>
    <div style="font:400 11.5px/1.4 ${FONT};color:#8a8578;padding-top:6px;">${esc(label)}</div>
  </td>`;
}

function courseStateOf(course: JobSummaryCourseResult): JobSummaryCourseState {
  if (course.state) return course.state;
  // 兼容旧任务摘要：没有 state 时按完成标记与进度回退推导
  if (course.completed || course.progress >= 100) return "completed";
  if (course.progress > 0) return "in_progress";
  return "pending";
}

/** 课程明细行：名称（截断 + 悬浮提示）、状态、进度条与本次产出 */
function courseRow(course: JobSummaryCourseResult): string {
  const state = courseStateOf(course);
  const meta = COURSE_STATE_META[state];
  const pct = state === "completed"
    ? 100
    : Math.min(100, Math.max(0, Math.round(course.progress)));
  const filled = Math.max(0, Math.min(100, pct));

  const facts: string[] = [];
  if (course.totalSeconds > 0) facts.push(`视频总长 ${fmtClock(course.totalSeconds)}`);
  if (course.videosCompleted) facts.push(`完成视频 ${course.videosCompleted}`);
  if (course.videosSkipped) facts.push(`跳过视频 ${course.videosSkipped}`);
  if (course.worksDone) facts.push(`作业 ${course.worksDone}`);
  if (course.examsDone) facts.push(`考试 ${course.examsDone}`);
  const lockedNote = course.videosLocked
    ? `<span style="color:#9a6212;">${course.videosLocked} 个视频未到解锁时间</span>`
    : state === "locked"
      ? `<span style="color:#9a6212;">课程暂未开放</span>`
      : "";
  const factLine = [...facts.map((f) => esc(f)), lockedNote].filter(Boolean).join(" · ");
  const detail = factLine || (state === "completed" ? "本次无需推进" : "本次未推进");

  return `<tr>
    <td style="padding:14px 0 0;border-top:1px solid #ece8dd;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
        <tr>
          <td style="padding:0 10px 0 0;">
            <div class="mail-name" title="${esc(course.name)}" style="font:700 13.5px/1.5 ${FONT};color:#20292c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;">${esc(shortName(course.name))}</div>
            <div style="font:400 12px/1.7 ${FONT};color:#8a8578;padding-top:4px;">${detail}</div>
          </td>
          <td width="96" align="right" valign="top" style="padding-top:1px;">
            <span style="display:inline-block;padding:2px 9px;border-radius:10px;background:${meta.bg};color:${meta.color};font:700 10.5px/1.6 ${FONT};white-space:nowrap;">${meta.label}</span>
            <div style="font:600 13px/1.4 ${MONO};color:${meta.color};padding-top:5px;">${pct}%</div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
        <tr>
          ${filled > 0 ? `<td width="${filled}%" height="6" bgcolor="${meta.bar}" style="font-size:0;line-height:0;">&nbsp;</td>` : ""}
          ${filled < 100 ? `<td width="${100 - filled}%" height="6" bgcolor="#e8e4d9" style="font-size:0;line-height:0;">&nbsp;</td>` : ""}
        </tr>
      </table>
    </td>
  </tr>`;
}

/** 课程明细块：任务收尾快照里有课程数据时渲染 */
function coursesBlock(results: JobSummaryCourseResult[] | undefined): string {
  if (!results?.length) return "";
  const done = results.filter((c) => courseStateOf(c) === "completed").length;
  const locked = results.filter((c) => courseStateOf(c) === "locked").length;
  const lockedText = locked > 0 ? ` · 未解锁 ${locked} 门` : "";
  return `<tr><td class="mail-pad" style="padding:20px 28px 0;">
    <div style="font:700 11.5px/1 ${FONT};letter-spacing:1px;color:#8a8578;padding-bottom:4px;">课程明细</div>
    <div style="font:400 12px/1.6 ${FONT};color:#9a9484;padding-bottom:10px;">共 ${results.length} 门 · 已完成 ${done} 门${lockedText}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${results.map(courseRow).join("")}
    </table>
  </td></tr>`;
}

/** 考试成绩块：有确认得分的考试时渲染，用于仅考试类任务的统计展示 */
function examScoresBlock(summary: JobSummary): string {
  const records = summary.examScores ?? [];
  if (!records.length) return "";
  const rows = records
    .map(
      (r) => `<tr>
        <td style="padding:8px 8px 8px 0;border-top:1px solid #ece8dd;font:400 12px/1.6 ${FONT};color:#2a3438;">${esc(shortName(r.courseName, 22))}</td>
        <td style="padding:8px 8px 8px 0;border-top:1px solid #ece8dd;font:400 12px/1.6 ${FONT};color:#2a3438;">${esc(shortName(r.examName, 22))}</td>
        <td width="52" align="right" style="padding:8px 0;border-top:1px solid #ece8dd;font:600 12px/1.6 ${MONO};color:#0c6b47;">${esc(String(r.score))}</td>
      </tr>`,
    )
    .join("");
  return `<tr><td class="mail-pad" style="padding:20px 28px 0;">
    <div style="font:700 11.5px/1 ${FONT};letter-spacing:1px;color:#8a8578;padding-bottom:10px;">考试成绩</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0 8px 4px 0;font:700 11px/1.4 ${FONT};color:#a8a296;">课程</td>
        <td style="padding:0 8px 4px 0;font:700 11px/1.4 ${FONT};color:#a8a296;">考试</td>
        <td width="52" align="right" style="padding:0 0 4px;font:700 11px/1.4 ${FONT};color:#a8a296;">得分</td>
      </tr>
      ${rows}
    </table>
  </td></tr>`;
}

/** 异常明细块：仅在有异常时渲染 */
function errorsBlock(errors: string[]): string {
  if (!errors.length) return "";
  const items = errors
    .map(
      (e) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0ddd9;font:400 12px/1.6 ${FONT};color:#7a2e26;">•&nbsp;${esc(e)}</td></tr>`,
    )
    .join("");
  return `<tr><td class="mail-pad" style="padding:20px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f9ece8" style="border:1px solid #eed6d0;">
      <tr><td style="padding:10px 12px 4px;font:700 11.5px/1 ${FONT};letter-spacing:1px;color:#b3261e;">异常明细（${errors.length}）</td></tr>
      ${items}
    </table>
  </td></tr>`;
}

/**
 * 任务报告邮件正文：纸感米白底 + 深墨报头 + 中文统计网格 + 课程状态明细。
 * 全部内联样式 + table 布局，不依赖外部资源；窄屏通过媒体查询收窄内边距。
 */
export function completionEmailHtml(opts: CompletionMailOptions): string {
  const s = opts.summary;
  const baseMeta = STATUS_META[opts.state] ?? STATUS_META.stopped;
  const hasErrors = s.errors.length > 0;
  const meta: StatusMeta =
    opts.state === "done" && hasErrors
      ? {
          ...baseMeta,
          label: "完成（有异常）",
          verb: "任务已完成，存在异常",
          desc: "任务已结束，但执行过程中出现部分异常，请查看下方异常明细。",
        }
      : baseMeta;
  const duration = new Date(opts.finishedAt).getTime() - new Date(opts.startedAt).getTime();

  const examCount = s.examsDone;
  const examScoreCount = s.examScores?.length ?? 0;
  const examSummary =
    examCount > 0
      ? `<div style="font:400 12.5px/1.7 ${FONT};color:#6d675b;padding-top:12px;">本次共完成考试 <b style="color:#20292c;">${examCount}</b> 场${
          examScoreCount > 0 ? `，记录成绩 <b style="color:#0c6b47;">${examScoreCount}</b> 条` : ""
        }。</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>任务报告</title>
<style>
  @media only screen and (max-width: 620px) {
    .mail-card { width: 100% !important; }
    .mail-pad { padding-left: 18px !important; padding-right: 18px !important; }
    .mail-title { font-size: 21px !important; }
    .mail-name { max-width: 220px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ece9e0;">
<table role="presentation" width="100%" bgcolor="#ece9e0" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
<tr><td align="center">
<table role="presentation" class="mail-card" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fdfcf8;border:1px solid #d9d4c7;">
  <tr>
    <td bgcolor="#20292c" style="padding:20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:700 13px/1 ${FONT};letter-spacing:3px;color:#ece7d8;">Yatori 面板</td>
        <td align="right" style="font:400 12px/1 ${FONT};letter-spacing:1px;color:#8d9a95;">任务报告</td>
      </tr></table>
    </td>
  </tr>
  <tr><td class="mail-pad" style="padding:26px 28px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="${meta.bg}" style="padding:5px 12px;border-radius:3px;font:700 11px/1.5 ${FONT};letter-spacing:1px;color:${meta.color};">${meta.label}</td>
    </tr></table>
    <div class="mail-title" style="font:700 24px/1.35 ${FONT};color:#20292c;padding-top:12px;">${meta.verb}</div>
    <div style="font:400 13px/1.7 ${FONT};color:#6d675b;padding-top:6px;">
      账号 <span style="color:#20292c;font-weight:700;">${accountLabel(opts.account)}</span> · ${meta.desc}
    </div>
    <div style="font:400 12px/1.9 ${FONT};color:#9a9484;padding-top:10px;">
      耗时 ${esc(fmtDuration(duration))} · 开始 ${esc(fmtTime(opts.startedAt))} · 结束 ${esc(fmtTime(opts.finishedAt))}
    </div>
    ${examSummary}
  </td></tr>
  <tr><td class="mail-pad" style="padding:22px 28px 4px;">
    <div style="font:700 11.5px/1 ${FONT};letter-spacing:1px;color:#8a8578;padding-bottom:12px;">产出明细</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${statCell(s.courses, "课程")}${statCell(s.videosCompleted, "完成视频", { right: true })}</tr>
      <tr>${statCell(s.videosSkipped, "跳过视频")}${statCell(s.worksDone, "完成作业", { right: true })}</tr>
      <tr>${statCell(s.examsDone, "完成考试")}${statCell(s.flagsFound, "标红节点", { right: true, accent: true })}</tr>
    </table>
  </td></tr>
  ${examScoresBlock(s)}
  ${coursesBlock(s.courseResults)}
  ${errorsBlock(s.errors)}
  <tr><td class="mail-pad" style="padding:22px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e0d5;"><tr>
      <td style="padding-top:12px;font:400 11.5px/1.9 ${FONT};color:#9a9484;">
        结束时间 ${esc(fmtTime(opts.finishedAt))}<br/>
        本邮件由 Yatori 面板自动发送，请勿直接回复
      </td>
    </tr></table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
