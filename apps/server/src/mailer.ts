import nodemailer from "nodemailer";
import { getSettings } from "./db/settings.ts";

/**
 * 任务完成邮件通知（fire-and-forget，失败仅记日志不抛出）。
 * 需在全局设置启用邮箱通知并填写 SMTP 信息。
 */
export async function sendCompletionMail(opts: {
  accountName: string;
  state: string;
  summaryHtml: string;
}): Promise<void> {
  const s = getSettings();
  if (!s.email.enabled || !s.email.smtpHost || !s.email.to || !s.email.user) return;

  const port = s.email.smtpPort;
  const transport = nodemailer.createTransport({
    host: s.email.smtpHost,
    port,
    secure: port === 465,
    auth: { user: s.email.user, pass: s.email.pass },
  });

  await transport.sendMail({
    from: s.email.user,
    to: s.email.to
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(","),
    subject: `[Yatori 面板] ${opts.accountName} 任务${opts.state === "done" ? "已完成" : "已结束"}`,
    html: `<p>账号：${opts.accountName}</p>${opts.summaryHtml}`,
  });
}
