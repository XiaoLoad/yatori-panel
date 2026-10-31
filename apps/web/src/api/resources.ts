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

export interface AccountWithSession extends AccountVO {
  hasSession: boolean;
}

export interface VerifyResult {
  ok: boolean;
  courseCount?: number;
}

export interface CreateAccountResult extends AccountVO {
  verify?: VerifyResult;
}

import type {
  AccountVO,
  CreateAccountBody,
  JobVO,
  PlatformMeta,
  Settings,
  StartJobBody,
  UpdateAccountBody,
} from "@yatori/shared";
import { del, get, post, put } from "./client";

export const api = {
  platforms: () => get<PlatformMeta[]>("/platforms"),

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

  startJob: (body: StartJobBody) => post<JobVO>("/jobs", body),
  stopJob: (id: string) =>
    post<{ stopped: boolean; reason?: string }>(`/jobs/${id}/stop`),
  jobs: (params?: { accountUid?: string; state?: string; limit?: number }) =>
    get<JobVO[]>("/jobs", params),

  settings: () => get<Settings>("/settings"),
  saveSettings: (body: Settings) => put<void>("/settings", body),

  dashboard: () =>
    get<{
      accountCount: number;
      onlineAccounts: number;
      runningJobs: number;
      recentJobs: JobVO[];
    }>("/dashboard"),
};
