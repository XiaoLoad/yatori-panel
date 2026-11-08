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

/** 账号课程完成度汇总（数据来自平台课程列表，非任务快照） */
export interface CourseSummaryVO {
  accountUid: string;
  ok: boolean;
  /** ok=false 时的失败原因（登录失效、网关不可达等） */
  error?: string;
  courseCount: number;
  /** 平台侧已完结（学时刷满或已结课）的课程数 */
  finishedCount: number;
  /** 全部课程平均进度（0-100） */
  avgProgress: number;
}

export const BatchDeleteAccountsBody = z.object({
  uids: z
    .array(
      z.string({ required_error: "请选择账号", invalid_type_error: "请选择账号" }).min(1, "缺少账号 ID"),
    )
    .min(1, "请至少选择一个账号")
    .max(50, "单次最多删除 50 个账号"),
});
export type BatchDeleteAccountsBody = z.infer<typeof BatchDeleteAccountsBody>;

export interface BatchDeleteAccountsResult {
  deleted: string[];
  failed: { uid: string; error: string }[];
}

// ---------- 账号分组（服务端持久化，跨设备同步） ----------

export interface AccountGroupVO {
  id: string;
  name: string;
  /** 组内账号 uid 列表，保持加入顺序 */
  accountUids: string[];
  createdAt: string;
}

export const CreateAccountGroupBody = z.object({
  name: z.string({ required_error: "分组名不能为空" }).trim().min(1, "分组名不能为空").max(30, "分组名最长 30 字"),
  accountUids: z.array(z.string()).default([]),
});
export type CreateAccountGroupBody = z.infer<typeof CreateAccountGroupBody>;

export const UpdateAccountGroupBody = z.object({
  name: z.string().trim().min(1, "分组名不能为空").max(30, "分组名最长 30 字").optional(),
  accountUids: z.array(z.string()).optional(),
});
export type UpdateAccountGroupBody = z.infer<typeof UpdateAccountGroupBody>;

// ---------- 账号展示身份（人 → 站点） ----------

function urlHost(baseUrl: string | null | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).host;
  } catch {
    return "";
  }
}

/** 站点短标签：域名首段（cqcst.tuozhikj.com → cqcst）；无有效地址返回空串 */
export function siteTagOf(baseUrl: string | null | undefined): string {
  const host = urlHost(baseUrl);
  if (!host) return "";
  return host.split(".")[0] ?? host;
}

export interface SiteTaggedAccount {
  uid: string;
  platform: string;
  username: string;
  baseUrl?: string | null;
}

/**
 * 计算「同平台同学号多站点」歧义账号的站点标签：uid → 站点标签。
 * 仅当同名组内存在多个不同站点时才产生标签（无歧义不出现在结果中）；
 * 组内短标签（域名首段）撞车时整组回退完整域名，保证组内两两可区分。
 */
export function siteTagsFor(accounts: SiteTaggedAccount[]): Map<string, string> {
  const groups = new Map<string, SiteTaggedAccount[]>();
  for (const a of accounts) {
    const key = `${a.platform}|${a.username}`;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    const sites = new Set(g.map((a) => a.baseUrl ?? ""));
    if (sites.size <= 1) continue;
    const shortTags = g.map((a) => siteTagOf(a.baseUrl));
    const useFullHost = new Set(shortTags).size !== shortTags.length;
    g.forEach((a, i) => {
      const host = urlHost(a.baseUrl);
      out.set(a.uid, useFullHost ? host || "未知站点" : shortTags[i] || "未知站点");
    });
  }
  return out;
}

/** 账号展示标签：备注（或学号）；有站点歧义时追加「 · 站点标签」 */
export function accountDisplayLabel(
  a: { remark?: string | null; username: string },
  siteTag?: string,
): string {
  const base = a.remark || a.username;
  return siteTag ? `${base} · ${siteTag}` : base;
}

// ---------- 任务 ----------

export const AnswerSourceEnum = z.enum(["off", "ai", "bank"]);
export type AnswerSource = z.infer<typeof AnswerSourceEnum>;

export const VideoModeEnum = z.union([z.literal(1), z.literal(2), z.literal(3)]);
/**
 * 1=普通：一门课内视频节点逐个刷。
 * 2=暴力：一门课内视频节点并发上报，结束后自动对该课程做一次去红。
 * 3=去红：只处理被平台标记「并行播放」的节点，逐条消红后结束。
 */
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

/** 批量启动：一次为多个账号发起任务，课程范围按账号单独指定 */
export const BatchStartJobBody = z.object({
  accounts: z
    .array(
      z.object({
        accountUid: z
          .string({ required_error: "请选择账号", invalid_type_error: "请选择账号" })
          .min(1, "请选择账号"),
        /** 为空 = 该账号全部课程 */
        courseIds: z.array(z.string()).optional().default([]),
      }),
    )
    .min(1, "请至少选择一个账号"),
  videoMode: VideoModeEnum.optional().default(1),
  answerSource: AnswerSourceEnum.optional().default("off"),
  submitMode: SubmitModeEnum.optional().default("off"),
  perCourseConcurrency: z.number().int().min(1).max(16).optional().default(4),
});
export type BatchStartJobBody = z.infer<typeof BatchStartJobBody>;

export interface BatchStartResult {
  started: { accountUid: string; jobId: string }[];
  failed: { accountUid: string; error: string }[];
}

export type JobState = "running" | "stopped" | "done" | "error";

// ---------- 定时任务 ----------

/** 到点停止行为：看完当前节点再停 / 立即停止 */
export const StopModeEnum = z.enum(["finish_current", "immediate"]);
export type StopMode = z.infer<typeof StopModeEnum>;

/**
 * 规则作用域：
 * all      = 全部账号（触发时现场解析当时所有启用账号，新增/删除账号无需改规则）
 * accounts = 指定账号（固定名单；名单为空时到点跳过并在列表标注警示）
 */
export const ScheduleScopeEnum = z.enum(["all", "accounts"]);
export type ScheduleScope = z.infer<typeof ScheduleScopeEnum>;

export interface ScheduleVO {
  id: string;
  /** 规则名称，便于多规则区分 */
  name: string;
  /** 作用域，见 ScheduleScopeEnum；旧数据迁移后恒有值 */
  scope: ScheduleScope;
  /** 指定账号作用域下的账号名单；all 作用域下为空数组 */
  accountUids: string[];
  /**
   * 指定课程 ID 名单：仅当 scope=accounts 且只绑定一个账号时可非空，
   * 非空时到点只刷这些课程；空数组 = 全部未完成课程
   */
  courseIds: string[];
  /** 开始时间（cron：分 时 日 月 周） */
  cron: string;
  /** 结束时间 HH:MM；为空表示不自动停止 */
  endTime?: string | null;
  stopMode: StopMode;
  videoMode: 1 | 2 | 3;
  answerSource: "off" | "ai" | "bank";
  submitMode: SubmitMode;
  enabled: boolean;
  lastRunAt?: string | null;
  createdAt: string;
}

export const CreateScheduleBody = z.object({
  name: z.string().optional().default(""),
  scope: ScheduleScopeEnum.optional(),
  accountUids: z.array(z.string().min(1)),
  courseIds: z.array(z.string().min(1)).optional(),
  cron: z
    .string({ required_error: "请填写 cron 表达式", invalid_type_error: "请填写 cron 表达式" })
    .min(1, "请填写 cron 表达式"),
  endTime: z
    .string()
    .regex(/^[0-2]\d:[0-5]\d$/, "结束时间格式为 HH:MM")
    .optional(),
  stopMode: StopModeEnum.optional().default("finish_current"),
  videoMode: VideoModeEnum.optional().default(1),
  answerSource: AnswerSourceEnum.optional().default("off"),
  submitMode: SubmitModeEnum.optional().default("off"),
})
  // 指定账号作用域至少要有一个账号；全部账号作用域不需要名单；
  // 指定课程是"高度定制"配置，只允许绑定单个账号的规则使用
  .superRefine((v, ctx) => {
    if ((v.scope ?? "accounts") === "accounts" && v.accountUids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountUids"],
        message: "请至少选择一个账号",
      });
    }
    if ((v.courseIds?.length ?? 0) > 0 && ((v.scope ?? "accounts") !== "accounts" || v.accountUids.length !== 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["courseIds"],
        message: "指定课程仅支持只绑定一个账号的规则",
      });
    }
  })
  // 结束时间必须晚于开始时间：调度器的到点停止沿用开始 cron 的日/月/周字段，
  // 若结束早于开始，停止会落空、任务将一直跑到下周同一时刻（不支持跨天窗口，避免通宵运行）
  .superRefine((v, ctx) => {
    if (!v.endTime) return;
    const start = startMinutesOfCron(v.cron);
    if (start === null) return; // cron 分钟/小时字段非纯数字（如 */10）时无法比较，交由 cron 校验兜底
    const [h, m] = v.endTime.split(":").map(Number);
    const end = (h ?? 0) * 60 + (m ?? 0);
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "结束时间必须晚于开始时间（不支持跨天，避免通宵运行）",
      });
    }
  });
export type CreateScheduleBody = z.infer<typeof CreateScheduleBody>;

/** 从 cron 提取当天开始时间（分钟数）；分/时字段均为纯数字时才可比较，否则返回 null */
export function startMinutesOfCron(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts;
  if (!minute || !hour || !/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  return Number(hour) * 60 + Number(minute);
}

/** 任务收尾时单门课程的推进快照，供邮件通知展示课程明细 */
export interface JobSummaryCourseResult {
  name: string;
  /** 0-100 整体进度（按已加载章节树的视频时长汇总） */
  progress: number;
  completed: boolean;
  /** 该课程视频总时长（秒），0 表示章节树未加载 */
  totalSeconds: number;
}

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
  /** 任务收尾时每门课程的推进快照；早期失败可能没有 */
  courseResults?: JobSummaryCourseResult[];
}

/** 任务失败原因分类：用于台账聚合排障，不改动既有 errors 文本 */
export type FailureCategory =
  | "login"
  | "captcha"
  | "video"
  | "work"
  | "exam"
  | "gateway"
  | "timeout"
  | "interrupted"
  | "other";

export interface FailureReason {
  category: FailureCategory;
  label: string;
  count: number;
  /** 受影响任务数 */
  jobCount: number;
  /** 最近一条原始错误信息，供下钻时参考 */
  sample: string;
}

export interface FailureBreakdown {
  total: number;
  errorJobs: number;
  reasons: FailureReason[];
  byAccount: { accountUid: string; accountName: string; count: number }[];
  recent: {
    jobId: string;
    accountUid: string;
    accountName: string;
    startedAt: string;
    category: FailureCategory;
    label: string;
    message: string;
  }[];
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
  /** 是否处于暂停状态（运行器仍在内存中，进度循环挂起） */
  paused?: boolean;
  /** 最近一次进度快照：页面刷新后仍能显示阶段/课程进度，而非停留在“准备” */
  progress?: JobEvent | null;
}

/** 通用分页结果：服务端分页时统一返回结构 */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 历史日志查询：按级别、账号、关键字过滤，服务端分页 */
export interface LogQuery {
  page?: number;
  pageSize?: number;
  level?: "all" | "info" | "warn" | "error";
  /** 全局输出档位：低于该级别的日志不返回 */
  minLevel?: "debug" | "info" | "warn" | "error";
  accountUid?: string;
  /** 仅查看某个任务的日志（日志页「当前任务」筛选） */
  jobId?: string;
  search?: string;
}

/** 日志删除：只能按时间段删除，且结束时间不得进入近 7 天 */
export const DeleteLogsBody = z.object({
  from: z.string({ required_error: "请选择开始时间" }).min(1, "请选择开始时间"),
  to: z.string({ required_error: "请选择结束时间" }).min(1, "请选择结束时间"),
});
export type DeleteLogsBody = z.infer<typeof DeleteLogsBody>;

export interface DeleteLogsResult {
  deleted: number;
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

export interface JobCourseProgress {
  courseId: string;
  courseName: string;
  /** 该课程视频总时长（秒） */
  totalSeconds: number;
  /** 该课程剩余视频时长（秒） */
  remainingSeconds: number;
  /** 0-100 */
  progress: number;
  completed: boolean;
  /** 章节树是否已加载，未加载时进度统计尚不可用 */
  loaded: boolean;
  /** 最近活跃的节点名，用于并行课程时区分当前在做什么 */
  currentNodeName?: string;
}

export interface JobEvent {
  type: JobEventType;
  ts: number;
  jobId?: string;
  accountId?: string;
  state?: JobState;
  /** 当前所处阶段：登录/视频/作业/考试 */
  phase?: "login" | "video" | "work" | "exam";
  courseId?: string;
  courseName?: string;
  nodeId?: string;
  nodeName?: string;
  progress?: number;
  watchedSeconds?: number;
  totalSeconds?: number;
  /** 任务覆盖课程的整体进度统计（按已加载章节树的视频时长汇总） */
  courseTotalSeconds?: number;
  courseRemainingSeconds?: number;
  courseCount?: number;
  coursesRemaining?: number;
  etaSeconds?: number;
  /** 每门课程的独立进度，供并行刷课的可视化展示 */
  coursesProgress?: JobCourseProgress[];
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

/** 日志输出档位：低于该档位的日志在日志页与观测台不再展示 */
export const DisplayLogLevelSchema = z.enum(["debug", "info", "warn", "error"]).default("info");
export type DisplayLogLevel = z.infer<typeof DisplayLogLevelSchema>;

export const SettingsSchema = z.object({
  ai: AiConfigSchema,
  questionBank: BankConfigSchema,
  email: EmailConfigSchema,
  tickSeconds: z.number().int().min(3).max(30).default(5),
  maxAccountsConcurrency: z.number().int().min(1).max(10).default(3),
  /** 同一账号同时推进的课程数：1=逐门课串行；N=最多 N 门课同时刷 */
  maxCoursesConcurrency: z.number().int().min(1).max(5).default(3),
  /** 日志输出档位（最低级别），debug 表示全部 */
  logLevel: DisplayLogLevelSchema,
  /** 日志自动保留天数：超出后启动清理时删除，7 天内强制保护 */
  logRetentionDays: z.number().int().min(7).max(365).default(30),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const UpdateSettingsBody = SettingsSchema;
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

/** 邮箱通知测试发送：使用设置页表单当前值，未保存也可测试 */
export const EmailTestBody = z.object({ email: EmailConfigSchema });
export type EmailTestBody = z.infer<typeof EmailTestBody>;
