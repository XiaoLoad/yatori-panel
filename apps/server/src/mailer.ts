import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { JobSummary, JobSummaryCourseResult } from "./shared.ts";
import { getSettings } from "./db/settings.ts";

/**
 * 任务完成邮件通知（fire-and-forget，失败仅记日志不抛出）。
 * 需在全局设置启用邮箱通知并填写 SMTP 信息。
 *
 * 模板为邮件客户端兼容的 table + 内联样式布局：
 * 不加载外部字体与图片，标题衬线、数据等宽，QQ 邮箱 / Gmail / Outlook 均可正常渲染。
 */

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
  to: string;
}

export interface CompletionMailOptions {
  account: { username: string; remark: string; siteTag?: string };
  state: string;
  summary: JobSummary;
  startedAt: string;
  finishedAt: string;
}

const STATUS_META: Record<string, { label: string; verb: string; color: string; barColor: string; bg: string; desc: string }> = {
  done: {
    label: "已完成",
    verb: "任务已完成",
    color: "#0c6b47",
    barColor: "#0c6b47",
    bg: "#e3f1ea",
    desc: "全部计划内容已推进完毕，以下为本次产出明细。",
  },
  error: {
    label: "出错",
    verb: "任务出错",
    color: "#b3261e",
    barColor: "#b3261e",
    bg: "#f9e8e5",
    desc: "任务在执行过程中出现错误并提前结束，请查看下方错误明细。",
  },
  stopped: {
    label: "已停止",
    verb: "任务已停止",
    color: "#57534e",
    barColor: "#78716c",
    bg: "#edeadf",
    desc: "任务已被手动停止，以下为停止前的产出明细。",
  },
};

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 耗时文案：1小时23分 / 45 分钟 / 不足 1 分钟 */
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
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** 账号展示：名称 · 学号（无备注时只显示学号）；同学号多站点时追加站点标签 */
function accountLabel(account: CompletionMailOptions["account"]): string {
  const name = account.remark?.trim();
  const uid = account.username?.trim();
  const site = account.siteTag?.trim()
    ? `<span style="color:#9a9484;"> · 站点 ${esc(account.siteTag.trim())}</span>`
    : "";
  if (name && uid) return `${esc(name)}${site}<span style="color:#9a9484;"> · 学号 ${esc(uid)}</span>`;
  return `${esc(uid || name || "未知账号")}${site}`;
}

/** 统计格：大号等宽数字 + 小标签 */
function statCell(value: number | string, label: string, accent = false): string {
  const color = accent && Number(value) > 0 ? "#b3261e" : "#1f2a2e";
  return `<td width="33%" style="padding:14px 12px 12px 0;border-top:1px solid #e4e0d5;">
    <div style="font:600 21px/1 'Courier New',Consolas,monospace;color:${color};">${esc(String(value))}</div>
    <div style="font:400 11px/1.4 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;color:#8a8578;letter-spacing:1px;padding-top:6px;">${esc(label)}</div>
  </td>`;
}

function emptyCell(): string {
  return `<td width="33%" style="border-top:1px solid #e4e0d5;">&nbsp;</td>`;
}

/** 课程明细行：课程名 + 进度条 + 百分比 + 状态 */
function courseRow(course: { name: string; progress: number; completed: boolean; totalSeconds: number }): string {
  const pct = Math.min(100, Math.max(0, Math.round(course.progress)));
  const filled = Math.round((pct / 100) * 120);
  const open = course.completed;
  const color = open ? "#0c6b47" : "#8a8578";
  return `<tr>
    <td style="padding:9px 0;border-top:1px solid #ece8dd;font:400 12.5px/1.5 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;color:#2a3438;">
      ${esc(course.name)}<span style="color:#b0aa9a;font-size:11px;">&nbsp;&nbsp;${course.totalSeconds > 0 ? `视频 ${fmtClock(course.totalSeconds)}` : ""}</span>
    </td>
    <td width="130" valign="middle" style="border-top:1px solid #ece8dd;padding:9px 0;">
      <table role="presentation" width="120" cellpadding="0" cellspacing="0"><tr>
        ${filled > 0 ? `<td width="${filled}" height="5" bgcolor="#0c6b47" style="font-size:0;line-height:0;">&nbsp;</td>` : ""}
        ${filled < 120 ? `<td width="${120 - filled}" height="5" bgcolor="#e8e4d9" style="font-size:0;line-height:0;">&nbsp;</td>` : ""}
      </tr></table>
    </td>
    <td width="44" align="right" valign="middle" style="border-top:1px solid #ece8dd;font:600 12px/1 'Courier New',Consolas,monospace;color:${color};">${pct}%</td>
    <td width="52" align="right" valign="middle" style="border-top:1px solid #ece8dd;font:400 11px/1 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;color:${color};letter-spacing:1px;">${open ? "已完成" : "未完成"}</td>
  </tr>`;
}

/** 课程明细块：任务收尾快照里有课程数据时渲染 */
function coursesBlock(results: JobSummaryCourseResult[] | undefined): string {
  if (!results?.length) return "";
  const done = results.filter((c) => c.completed).length;
  return `<tr><td style="padding:18px 28px 0;">
    <div style="font:700 11px/1 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:2px;color:#8a8578;padding-bottom:10px;">课程明细 / COURSES（${results.length} 门 · 已完成 ${done}）</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${results.map(courseRow).join("")}
    </table>
  </td></tr>`;
}

/** 错误明细块：仅在有错误时渲染 */
function errorsBlock(errors: string[]): string {
  if (!errors.length) return "";
  const items = errors
    .map(
      (e) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #f0ddd9;font:400 12px/1.6 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;color:#7a2e26;">•&nbsp;${esc(e)}</td></tr>`,
    )
    .join("");
  return `<tr><td style="padding:18px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f9ece8" style="border:1px solid #eed6d0;">
      <tr><td style="padding:10px 12px 4px;font:700 11px/1 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:2px;color:#b3261e;">错误明细（${errors.length}）</td></tr>
      ${items}
    </table>
  </td></tr>`;
}

/**
 * 任务报告邮件正文：纸感米白底 + 深墨报头 + 等宽数据统计网格 + 课程明细进度条。
 * 全部内联样式 + table 布局，不依赖外部资源。
 */
export function completionEmailHtml(opts: CompletionMailOptions): string {
  const meta = STATUS_META[opts.state] ?? STATUS_META.stopped;
  const s = opts.summary;
  const duration = new Date(opts.finishedAt).getTime() - new Date(opts.startedAt).getTime();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#ece9e0;">
<table role="presentation" width="100%" bgcolor="#ece9e0" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fdfcf8;border:1px solid #d9d4c7;">
  <tr>
    <td bgcolor="#20292c" style="padding:20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:700 13px/1 Georgia,'Times New Roman',serif;letter-spacing:4px;color:#ece7d8;">YATORI<span style="color:#8fbfa6;">PANEL</span></td>
        <td align="right" style="font:400 11px/1 'Courier New',Consolas,monospace;letter-spacing:2px;color:#8d9a95;">任务报告 / JOB&nbsp;REPORT</td>
      </tr></table>
    </td>
  </tr>
  <tr><td style="padding:26px 28px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="${meta.bg}" style="padding:5px 12px;border-radius:3px;font:700 11px/1.4 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:2px;color:${meta.color};">${meta.label}</td>
    </tr></table>
    <div style="font:700 24px/1.35 Georgia,'Times New Roman','PingFang SC','Microsoft YaHei',serif;color:#20292c;padding-top:12px;">${meta.verb}</div>
    <div style="font:400 13px/1.7 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;color:#6d675b;padding-top:6px;">
      账号 <span style="color:#20292c;font-weight:700;">${accountLabel(opts.account)}</span> · ${meta.desc}
    </div>
    <div style="font:400 11px/1.8 'Courier New',Consolas,monospace;color:#9a9484;padding-top:10px;letter-spacing:1px;">
      DURATION ${esc(fmtDuration(duration))}&nbsp;&nbsp;·&nbsp;&nbsp;START ${esc(fmtTime(opts.startedAt))}
    </div>
  </td></tr>
  <tr><td style="padding:22px 28px 4px;">
    <div style="font:700 11px/1 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:2px;color:#8a8578;padding-bottom:12px;">产出明细 / OUTPUT</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${statCell(s.courses, "课程 COURSES")}${statCell(s.videosCompleted, "完成视频 VIDEOS")}${statCell(s.videosSkipped, "跳过 SKIPPED")}</tr>
      <tr>${statCell(s.worksDone, "作业 WORKS")}${statCell(s.examsDone, "考试 EXAMS")}${statCell(s.flagsFound, "标红 FLAGS", true)}</tr>
    </table>
  </td></tr>
  ${coursesBlock(s.courseResults)}
  ${errorsBlock(s.errors)}
  <tr><td style="padding:22px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e0d5;"><tr>
      <td style="padding-top:12px;font:400 11px/1.8 'Courier New',Consolas,monospace;color:#9a9484;">
        FINISHED&nbsp;AT&nbsp;${esc(fmtTime(opts.finishedAt))}<br/>
        本邮件由 Yatori Panel 自动发送，请勿直接回复
      </td>
      <td align="right" style="padding-top:12px;font:400 11px/1.8 'Courier New',Consolas,monospace;color:#b5afa0;" valign="top">—</td>
    </tr></table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function makeTransport(cfg: EmailConfig): Transporter {
  const port = cfg.smtpPort;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    secure: port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

function subjectOf(account: CompletionMailOptions["account"], state: string): string {
  const meta = STATUS_META[state] ?? STATUS_META.stopped;
  const label = account.remark?.trim() || account.username?.trim() || "账号";
  return `[Yatori 面板] ${label} ${meta.verb}`;
}

async function sendMail(cfg: EmailConfig, subject: string, html: string): Promise<void> {
  const to = cfg.to
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
  await makeTransport(cfg).sendMail({ from: cfg.user, to, subject, html });
}

export async function sendCompletionMail(opts: CompletionMailOptions): Promise<void> {
  const s = getSettings();
  if (!s.email.enabled || !s.email.smtpHost || !s.email.to || !s.email.user) return;
  await sendMail(s.email, subjectOf(opts.account, opts.state), completionEmailHtml(opts));
}

/**
 * 测试发送：使用设置页表单当前值（可未保存），以样例数据渲染与真实通知
 * 完全一致的模板，发送到收件箱供用户确认 SMTP 配置是否可用。
 */
export async function sendTestMail(cfg: EmailConfig): Promise<string> {
  const finishedAt = new Date();
  const startedAt = new Date(finishedAt.getTime() - 83 * 60_000);
  const html = completionEmailHtml({
    account: { username: "2025305835", remark: "示例账号" },
    state: "done",
    summary: {
      courses: 3,
      videosCompleted: 12,
      videosSkipped: 2,
      flagsFound: 0,
      worksDone: 4,
      examsDone: 1,
      scores: [] as string[],
      errors: [] as string[],
      courseResults: [
        { name: "高等数学（下）", progress: 100, completed: true, totalSeconds: 4212 },
        { name: "马克思主义基本原理概论", progress: 100, completed: true, totalSeconds: 5883 },
        { name: "大学英语（四）", progress: 76, completed: false, totalSeconds: 3060 },
      ],
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
  await sendMail(cfg, "[Yatori 面板] 测试邮件 · 通知通道正常", html);
  return cfg.to
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join("、");
}
