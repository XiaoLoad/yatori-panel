// 服务端出参 DTO：与 apps/server 的 gateway DTO / 路由返回一一对应

export interface CourseDTO {
  id: string;
  name: string;
  teacher: string;
  cover: string;
  progress: number;
  status: string;
  extra?: Record<string, string>;
}

export interface NodeDTO {
  id: string;
  parentId?: string;
  courseId?: string;
  name: string;
  kind: string;
  durationSeconds: number;
  progress: number;
  completed: boolean;
  children: NodeDTO[];
  extra?: Record<string, string>;
}

export interface ExamDTO {
  id: string;
  courseId: string;
  name: string;
  status: string;
  startAt?: string;
  endAt?: string;
  durationSeconds: number;
  questionCount: number;
  extra?: Record<string, string>;
}

/** 考试参与状态与得分（仅英华支持只读查询） */
export interface ExamStatusDTO {
  examId: string;
  nodeId: string;
  taken: boolean;
  score?: number | null;
  message?: string;
  error?: string;
  checkedAt?: string;
}

export interface ExamResultDTO {
  taskId: string;
  title: string;
  submitted: boolean;
  score: number;
  message?: string;
}

export interface ExamStartResult {
  started: boolean;
  examName: string;
}

export interface ExamRunningItem {
  accountUid: string;
  courseId: string;
  examId: string;
}

export interface WorkDTO {
  id: string;
  courseId: string;
  name: string;
  status: string;
  deadline?: string;
  questionCount: number;
  extra?: Record<string, string>;
}

export interface WorkStartResult {
  started: boolean;
  count: number;
  names: string[];
}

export interface WorkRunningItem {
  accountUid: string;
  courseId: string;
  workId: string;
}

/** 作业提交状态与得分（仅英华支持只读查询，不消耗做题次数） */
export interface WorkStatusDTO {
  workId: string;
  nodeId: string;
  taken: boolean;
  score?: number | null;
  message?: string;
  error?: string;
  checkedAt?: string;
}

export interface AccountWithSession extends AccountVO {
  hasSession: boolean;
  sessionState?: string; // logging_in / online / error
}

export interface VerifyResult {
  ok: boolean;
  courseCount?: number;
  /** 备注为空时服务端自动填入的平台姓名 */
  remark?: string;
}

/** 打开平台并复制登录信息时按需获取 */
export interface AccountCredentials {
  username: string;
  password: string;
  entryUrl: string;
}

export interface CreateAccountResult extends AccountVO {
  verify?: VerifyResult;
}

import type {
  AccountVO,
  BatchStartJobBody,
  BatchStartResult,
  CreateScheduleBody,
  ScheduleVO,
  CreateAccountBody,
  DeleteLogsBody,
  DeleteLogsResult,
  JobEvent,
  JobVO,
  LogQuery,
  PageResult,
  PlatformMeta,
  Settings,
  StartJobBody,
  UpdateAccountBody,
} from "@yatori/shared";
import { del, get, post, put } from "./client";

/** 面板只开放已重点适配的平台：学习通、英华 */
const SUPPORTED_PLATFORMS: string[] = ["YINGHUA", "XUEXITONG"];

export const api = {
  platforms: async () =>
    (await get<PlatformMeta[]>("/platforms")).filter((p) => SUPPORTED_PLATFORMS.includes(p.key)),

  authStatus: () =>
    get<{ authRequired: boolean; authed: boolean }>("/auth/status"),
  login: (password: string) => post<void>("/auth/login", { password }),
  logout: () => post<void>("/auth/logout"),
  setPassword: (newPassword: string) =>
    put<void>("/auth/password", { newPassword }),
  disablePassword: () => del<void>("/auth/password"),

  accounts: () => get<AccountWithSession[]>("/accounts"),
  createAccount: (body: CreateAccountBody) =>
    post<CreateAccountResult>("/accounts", body),
  verifyAccount: (uid: string) =>
    post<VerifyResult>(`/accounts/${uid}/verify`),
  credentials: (uid: string) =>
    get<AccountCredentials>(`/accounts/${uid}/credentials`),
  updateAccount: (uid: string, body: UpdateAccountBody) =>
    put<void>(`/accounts/${uid}`, body),
  deleteAccount: (uid: string) => del<void>(`/accounts/${uid}`),

  courses: (uid: string) => get<CourseDTO[]>(`/accounts/${uid}/courses`),
  tree: (uid: string, courseId: string) =>
    get<NodeDTO[]>(`/accounts/${uid}/courses/${courseId}/tree`),
  exams: (uid: string, courseId: string) =>
    get<ExamDTO[]>(`/accounts/${uid}/courses/${courseId}/exams`),
  /** 考试状态与成绩只读查询（仅英华，不进入考试、不消耗答题次数） */
  examResults: (uid: string, courseId: string, exams: { examId: string; nodeId: string }[]) =>
    post<ExamStatusDTO[]>(`/accounts/${uid}/courses/${courseId}/exams/results`, { exams }),
  doExam: (
    uid: string,
    courseId: string,
    body: {
      examId: string;
      examName?: string;
      source: "off" | "ai" | "bank";
      submitMode?: "off" | "direct" | "smart";
    },
  ) => post<ExamStartResult>(`/accounts/${uid}/courses/${courseId}/exams/do`, body),
  runningExams: (uid: string) =>
    get<ExamRunningItem[]>(`/accounts/${uid}/exams/running`),

  works: (uid: string, courseId: string) =>
    get<WorkDTO[]>(`/accounts/${uid}/courses/${courseId}/works`),
  /** 作业状态与成绩只读查询（仅英华，不进入作答、不消耗做题次数） */
  workResults: (uid: string, courseId: string, works: { workId: string; nodeId: string }[]) =>
    post<WorkStatusDTO[]>(`/accounts/${uid}/courses/${courseId}/works/results`, { works }),
  doWork: (
    uid: string,
    courseId: string,
    body: {
      works: { workId: string; workName?: string }[];
      source: "off" | "ai" | "bank";
      submit?: boolean;
    },
  ) => post<WorkStartResult>(`/accounts/${uid}/courses/${courseId}/works/do`, body),
  runningWorks: (uid: string) =>
    get<WorkRunningItem[]>(`/accounts/${uid}/works/running`),

  startJob: (body: StartJobBody) => post<JobVO>("/jobs", body),
  startJobsBatch: (body: BatchStartJobBody) =>
    post<BatchStartResult>("/jobs/batch", body),
  stopJob: (id: string, graceful = false) =>
    post<{ stopped: boolean; reason?: string }>(
      `/jobs/${id}/stop`,
      graceful ? { graceful: true } : undefined,
    ),
  pauseJob: (id: string) => post<{ paused: boolean }>(`/jobs/${id}/pause`),
  resumeJob: (id: string) => post<{ paused: boolean }>(`/jobs/${id}/resume`),
  jobs: (params?: { accountUid?: string; state?: string; limit?: number }) =>
    get<JobVO[]>("/jobs", params),
  /** 台账分页：筛选与分页由服务端处理 */
  jobsPage: (params: {
    accountUid?: string;
    state?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) => get<PageResult<JobVO>>("/jobs/history", params),
  /** 全站持久化日志，用于观测台刷新后回填历史 */
  logEvents: (limit = 300) => get<JobEvent[]>("/logs", { limit }),
  /** 日志分页检索：级别 / 账号 / 关键字 */
  logsPage: (params: {
    page?: number;
    pageSize?: number;
    level?: LogQuery["level"];
    accountUid?: string;
    jobId?: string;
    search?: string;
  }) => get<PageResult<JobEvent>>("/logs/history", params),
  /** 按时间段删除日志（服务端强制保护近 7 天） */
  deleteLogs: (body: DeleteLogsBody) => del<DeleteLogsResult>("/logs", body),

  settings: () => get<Settings>("/settings"),
  saveSettings: (body: Settings) => put<void>("/settings", body),
  importConfig: (yaml: string) =>
    post<{ imported: number; skipped: number; failed: { account: string; error: string }[] }>(
      "/accounts/import",
      { yaml },
    ),
  schedules: () => get<ScheduleVO[]>("/schedules"),
  createSchedule: (body: CreateScheduleBody) => post<ScheduleVO>("/schedules", body),
  deleteSchedule: (id: string) => del<void>(`/schedules/${id}`),
  toggleSchedule: (id: string) => post<{ enabled: boolean }>(`/schedules/${id}/toggle`),
  preflight: (body: {
    source: "ai" | "bank";
    ai?: { type: string; url: string; model: string; apiKey: string };
    questionBank?: { url: string; key: string };
  }) => post<{ available: boolean; error?: string }>("/preflight", body),

  dashboard: () =>
    get<{
      accountCount: number;
      onlineAccounts: number;
      runningJobs: number;
      recentJobs: JobVO[];
    }>("/dashboard"),

  statsDaily: (days = 14) =>
    get<{ day: string; jobs: number; errors: number; videos: number }[]>("/stats/daily", { days }),
};
