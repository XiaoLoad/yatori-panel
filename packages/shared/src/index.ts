import { z } from "zod";

// ---------- 平台元数据（与网关 /platforms 对齐） ----------

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
}

export interface PlatformMeta {
  key: string;
  name: string;
  capabilities?: string[];
  loginFields: FieldSpec[];
  mvp: boolean;
}

// ---------- 账号 ----------

export interface AccountVO {
  uid: string;
  platform: string;
  platformName?: string;
  baseUrl?: string;
  /** 可选出站代理，如 http://127.0.0.1:7890 */
  proxyUrl?: string;
  username: string;
  remark: string;
  enabled: boolean;
  lastVerifyAt?: string | null;
  lastVerifyOk?: number | null;
  createdAt: string;
}

export const CreateAccountBody = z.object({
  platform: z
    .string({ required_error: "请选择平台", invalid_type_error: "请选择平台" })
    .min(1, "请选择平台"),
  baseUrl: z.string().optional().default(""),
  proxyUrl: z.string().optional().default(""),
  username: z
    .string({ required_error: "账号不能为空", invalid_type_error: "账号不能为空" })
    .min(1, "账号不能为空"),
  password: z
    .string({ required_error: "密码不能为空", invalid_type_error: "密码不能为空" })
    .min(1, "密码不能为空"),
  remark: z.string().optional().default(""),
  verify: z.boolean().optional().default(true),
});
export type CreateAccountBody = z.infer<typeof CreateAccountBody>;

export const UpdateAccountBody = z.object({
  baseUrl: z.string().optional(),
  proxyUrl: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  remark: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateAccountBody = z.infer<typeof UpdateAccountBody>;

// ---------- 任务 ----------

export const AnswerSourceEnum = z.enum(["off", "ai", "bank"]);
export type AnswerSource = z.infer<typeof AnswerSourceEnum>;

export const VideoModeEnum = z.union([z.literal(1), z.literal(2), z.literal(3)]);
/** 1=普通(节点串行) 2=暴力(节点并发) 3=去红(重跑未完成节点) */
export type VideoMode = z.infer<typeof VideoModeEnum>;

/** 交卷策略：off=仅保存不交卷 direct=答完直接交卷 smart=智能交卷（检测留空，留空则仅保存） */
export const SubmitModeEnum = z.enum(["off", "direct", "smart"]);
export type SubmitMode = z.infer<typeof SubmitModeEnum>;

export const StartJobBody = z.object({
  accountUid: z
    .string({ required_error: "请选择账号", invalid_type_error: "请选择账号" })
    .min(1, "请选择账号"),
  /** 为空 = 全部课程 */
  courseIds: z.array(z.string()).optional().default([]),
  videoMode: VideoModeEnum.optional().default(1),
  answerSource: AnswerSourceEnum.optional().default("off"),
  submitMode: SubmitModeEnum.optional().default("off"),
  perCourseConcurrency: z.number().int().min(1).max(16).optional().default(4),
});
export type StartJobBody = z.infer<typeof StartJobBody>;

export type JobState = "running" | "stopped" | "done" | "error";

// ---------- 定时任务 ----------

export interface ScheduleVO {
  id: string;
  accountUid: string;
  cron: string;
  videoMode: 1 | 2 | 3;
  answerSource: "off" | "ai" | "bank";
  submitMode: SubmitMode;
  enabled: boolean;
  lastRunAt?: string | null;
  createdAt: string;
}

export const CreateScheduleBody = z.object({
  accountUid: z
    .string({ required_error: "请选择账号", invalid_type_error: "请选择账号" })
    .min(1, "请选择账号"),
  cron: z
    .string({ required_error: "请填写 cron 表达式", invalid_type_error: "请填写 cron 表达式" })
    .min(1, "请填写 cron 表达式"),
  videoMode: VideoModeEnum.optional().default(1),
  answerSource: AnswerSourceEnum.optional().default("off"),
  submitMode: SubmitModeEnum.optional().default("off"),
});
export type CreateScheduleBody = z.infer<typeof CreateScheduleBody>;

export interface JobSummary {
  courses: number;
  videosCompleted: number;
  videosSkipped: number;
  flagsFound: number;
  worksDone: number;
  examsDone: number;
  /** 已提交的作业/考试得分，如 "第一章测试 85分" */
  scores: string[];
  errors: string[];
}

export interface JobVO {
  id: string;
  accountUid: string;
  accountName?: string;
  options: StartJobBody;
  state: JobState;
  startedAt: string;
  finishedAt?: string | null;
  summary?: JobSummary | null;
}

// ---------- 事件流（SSE） ----------

export type JobEventType =
  | "job.status"
  | "task.progress"
  | "task.flag"
  | "log"
  | "account.state"
  | "gateway.status";

export type GatewayDetail = "ok" | "conn-refused" | "timeout" | "error";

export interface JobEvent {
  type: JobEventType;
  ts: number;
  jobId?: string;
  accountId?: string;
  state?: JobState;
  courseId?: string;
  courseName?: string;
  nodeId?: string;
  nodeName?: string;
  progress?: number;
  watchedSeconds?: number;
  totalSeconds?: number;
  reason?: string;
  level?: string;
  message?: string;
  summary?: JobSummary;
  /** gateway.status 专用：当前在线状态与故障类别 */
  up?: boolean;
  detail?: GatewayDetail;
}

// ---------- 全局设置 ----------

export const AiConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.string().default("TONGYI"),
  url: z.string().default(""),
  model: z.string().default(""),
  apiKey: z.string().default(""),
});

export const BankConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  key: z.string().default(""),
});

export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  smtpHost: z.string().default(""),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  user: z.string().default(""),
  pass: z.string().default(""),
  /** 收件人，逗号分隔 */
  to: z.string().default(""),
});

export const SettingsSchema = z.object({
  ai: AiConfigSchema,
  questionBank: BankConfigSchema,
  email: EmailConfigSchema,
  tickSeconds: z.number().int().min(3).max(30).default(5),
  maxAccountsConcurrency: z.number().int().min(1).max(10).default(3),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const UpdateSettingsBody = SettingsSchema;
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;
