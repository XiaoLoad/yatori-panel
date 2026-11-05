import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { JobSummary } from "./shared.ts";
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

const STATUS_META: Record<string, { label: string; verb: string; color: string; bg: string; desc: string }> = {
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
    desc: "任务在执行过程中出现错误并提前结束，请查看下方错误明细。",
  },
  stopped: {
    label: "已停止",
    verb: "任务已停止",
    color: "#57534e",
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
 * 任务报告邮件正文：纸感米白底 + 深墨报头 + 等宽数据统计网格。
 * 全部内联样式 + table 布局，不依赖外部资源。
 */
export function completionEmailHtml(opts: {
  accountName: string;
  state: string;
  summary: Pick<JobSummary, "courses" | "videosCompleted" | "videosSkipped" | "flagsFound" | "worksDone" | "examsDone" | "errors">;
  finishedAt: string;
}): string {
  const meta = STATUS_META[opts.state] ?? STATUS_META.stopped;
  const s = opts.summary;
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
      账号 <span style="color:#20292c;font-weight:700;">${esc(opts.accountName)}</span> · ${meta.desc}
    </div>
  </td></tr>
  <tr><td style="padding:22px 28px 4px;">
    <div style="font:700 11px/1 Verdana,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:2px;color:#8a8578;padding-bottom:12px;">产出明细 / OUTPUT</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${statCell(s.courses, "课程 COURSES")}${statCell(s.videosCompleted, "完成视频 VIDEOS")}${statCell(s.videosSkipped, "跳过 SKIPPED")}</tr>
      <tr>${statCell(s.worksDone, "作业 WORKS")}${statCell(s.examsDone, "考试 EXAMS")}${statCell(s.flagsFound, "标红 FLAGS", true)}</tr>
    </table>
  </td></tr>
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

function subjectOf(accountName: string, state: string): string {
  const meta = STATUS_META[state] ?? STATUS_META.stopped;
  return `[Yatori 面板] ${accountName} ${meta.verb}`;
}

async function sendMail(cfg: EmailConfig, subject: string, html: string): Promise<void> {
  const to = cfg.to
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
  await makeTransport(cfg).sendMail({ from: cfg.user, to, subject, html });
}

export async function sendCompletionMail(opts: {
  accountName: string;
  state: string;
  summary: Parameters<typeof completionEmailHtml>[0]["summary"];
  finishedAt: string;
}): Promise<void> {
  const s = getSettings();
  if (!s.email.enabled || !s.email.smtpHost || !s.email.to || !s.email.user) return;
  await sendMail(
    s.email,
    subjectOf(opts.accountName, opts.state),
    completionEmailHtml({ accountName: opts.accountName, state: opts.state, summary: opts.summary, finishedAt: opts.finishedAt }),
  );
}

/**
 * 测试发送：使用设置页表单当前值（可未保存），以样例数据渲染与真实通知
 * 完全一致的模板，发送到收件箱供用户确认 SMTP 配置是否可用。
 */
export async function sendTestMail(cfg: EmailConfig): Promise<string> {
  const summary = {
    courses: 3,
    videosCompleted: 12,
    videosSkipped: 2,
    flagsFound: 0,
    worksDone: 4,
    examsDone: 1,
    errors: [] as string[],
  };
  const html = completionEmailHtml({
    accountName: "示例账号",
    state: "done",
    summary,
    finishedAt: new Date().toISOString(),
  });
  await sendMail(cfg, "[Yatori 面板] 测试邮件 · 通知通道正常", html);
  return cfg.to
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join("、");
}
