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

export const StartJobBody = z.object({
  accountUid: z
    .string({ required_error: "请选择账号", invalid_type_error: "请选择账号" })
    .min(1, "请选择账号"),
  /** 为空 = 全部课程 */
  courseIds: z.array(z.string()).optional().default([]),
  videoMode: VideoModeEnum.optional().default(1),
  answerSource: AnswerSourceEnum.optional().default("off"),
  autoSubmit: z.boolean().optional().default(false),
  perCourseConcurrency: z.number().int().min(1).max(16).optional().default(4),
});
export type StartJobBody = z.infer<typeof StartJobBody>;

export type JobState = "running" | "stopped" | "done" | "error";

export interface JobSummary {
  courses: number;
  videosCompleted: number;
  videosSkipped: number;
  flagsFound: number;
  worksDone: number;
  examsDone: number;
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
  | "account.state";

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

export const SettingsSchema = z.object({
  ai: AiConfigSchema,
  questionBank: BankConfigSchema,
  tickSeconds: z.number().int().min(3).max(30).default(5),
  maxAccountsConcurrency: z.number().int().min(1).max(10).default(3),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const UpdateSettingsBody = SettingsSchema;
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;
