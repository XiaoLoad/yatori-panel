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
  JobEvent,
  JobVO,
  PlatformMeta,
  Settings,
  StartJobBody,
  UpdateAccountBody,
} from "@yatori/shared";
import { del, get, post, put } from "./client";

export const api = {
  platforms: () => get<PlatformMeta[]>("/platforms"),

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
  updateAccount: (uid: string, body: UpdateAccountBody) =>
    put<void>(`/accounts/${uid}`, body),
  deleteAccount: (uid: string) => del<void>(`/accounts/${uid}`),

  courses: (uid: string) => get<CourseDTO[]>(`/accounts/${uid}/courses`),
  tree: (uid: string, courseId: string) =>
    get<NodeDTO[]>(`/accounts/${uid}/courses/${courseId}/tree`),
  exams: (uid: string, courseId: string) =>
    get<ExamDTO[]>(`/accounts/${uid}/courses/${courseId}/exams`),
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

  startJob: (body: StartJobBody) => post<JobVO>("/jobs", body),
  startJobsBatch: (body: BatchStartJobBody) =>
    post<BatchStartResult>("/jobs/batch", body),
  stopJob: (id: string, graceful = false) =>
    post<{ stopped: boolean; reason?: string }>(
      `/jobs/${id}/stop`,
      graceful ? { graceful: true } : undefined,
    ),
  jobs: (params?: { accountUid?: string; state?: string; limit?: number }) =>
    get<JobVO[]>("/jobs", params),
  /** 全站持久化日志，用于观测台刷新后回填历史 */
  logEvents: (limit = 300) => get<JobEvent[]>("/logs", { limit }),

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
