import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { MailAccount } from "./mail-template.ts";
import { completionEmailHtml } from "./mail-template.ts";
import type { CompletionMailOptions } from "./mail-template.ts";
import { getSettings } from "./db/settings.ts";

/**
 * 任务完成邮件通知（fire-and-forget，失败仅记日志不抛出）。
 * 需在全局设置启用邮箱通知并填写 SMTP 信息。
 * 模板渲染见 mail-template.ts，本文件只负责 SMTP 传输与收件人处理。
 */

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
  to: string;
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

function subjectOf(account: MailAccount, state: string): string {
  const label = account.remark?.trim() || account.username?.trim() || "账号";
  const verb =
    state === "error" ? "任务出错" : state === "stopped" ? "任务已停止" : "任务已完成";
  return `[Yatori 面板] ${label} ${verb}`;
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
      courses: 4,
      videosCompleted: 8,
      videosSkipped: 4,
      flagsFound: 0,
      worksDone: 3,
      examsDone: 2,
      scores: [
        "高等数学（下）/ 期中测试 92分",
        "马克思主义基本原理概论 / 章节作业 88分",
      ],
      examScores: [
        { courseName: "高等数学（下）", examName: "期中测试", score: 92 },
        { courseName: "创业基础", examName: "结课考试", score: 85 },
      ],
      errors: [] as string[],
      courseResults: [
        {
          name: "习近平新时代中国特色社会主义思想概论（2026年秋季学期网络课程）",
          progress: 100,
          completed: true,
          totalSeconds: 4212,
          state: "completed",
          videosCompleted: 5,
          videosSkipped: 0,
          videosLocked: 0,
          worksDone: 1,
          examsDone: 1,
        },
        {
          name: "大学英语（四）",
          progress: 76,
          completed: false,
          totalSeconds: 3060,
          state: "in_progress",
          videosCompleted: 2,
          videosSkipped: 1,
          videosLocked: 0,
          worksDone: 2,
          examsDone: 0,
        },
        {
          name: "马克思主义基本原理概论",
          progress: 42,
          completed: false,
          totalSeconds: 5883,
          state: "locked",
          videosCompleted: 1,
          videosSkipped: 3,
          videosLocked: 3,
          worksDone: 0,
          examsDone: 0,
        },
        {
          name: "创业基础",
          progress: 100,
          completed: true,
          totalSeconds: 0,
          state: "completed",
          videosCompleted: 0,
          videosSkipped: 0,
          videosLocked: 0,
          worksDone: 0,
          examsDone: 1,
        },
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
