import { env } from "./env.ts";

// ---------- 网关 DTO（与 gateway/handlers.go 的出参一一对应） ----------

export interface GatewayCourse {
  id: string;
  name: string;
  teacher: string;
  cover: string;
  progress: number;
  status: string;
  extra?: Record<string, string>;
}

export interface GatewayNode {
  id: string;
  parentId?: string;
  courseId?: string;
  name: string;
  kind: string;
  durationSeconds: number;
  progress: number;
  completed: boolean;
  children: GatewayNode[];
  extra?: Record<string, string>;
}

export interface GatewayWork {
  id: string;
  courseId: string;
  name: string;
  status: string;
  deadline?: string;
  questionCount: number;
  extra?: Record<string, string>;
}

export interface GatewayExam {
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

export interface GatewayStudyResult {
  courseId: string;
  nodeId: string;
  kind: string;
  submitted: boolean;
  positionSeconds: number;
  progress: number;
  completed: boolean;
  message?: string;
  raw?: unknown;
}

export interface GatewayAnswerDetail {
  questionId: string;
  question?: string;
  type?: string;
  options?: string[];
  /** AI/题库给出的答案数组；留空的题为空数组 */
  value?: string[];
  correct?: boolean;
}

export interface GatewayAnswerResult {
  taskId: string;
  title: string;
  submitted: boolean;
  score: number;
  message?: string;
  /** 逐题作答明细（智能交卷据此判断留空） */
  answers?: GatewayAnswerDetail[];
}

export interface GatewaySessionInfo {
  sessionId: string;
  platform: string;
  platformName: string;
  account: string;
  capabilities: string[];
  createdAt: string;
  state: string; // logging_in / online / error
  lastError?: string;
}

export interface GatewayLogEntry {
  level: string;
  time: string;
  message: string;
}

export interface PlatformMetaDTO {
  key: string;
  name: string;
  capabilities?: string[];
  loginFields: {
    key: string;
    label: string;
    required: boolean;
    secret: boolean;
    placeholder?: string;
  }[];
  mvp: boolean;
}

// ---------- 客户端 ----------

export class GatewayError extends Error {
  status: number;
  logs?: GatewayLogEntry[];
  constructor(message: string, status: number, logs?: GatewayLogEntry[]) {
    super(message);
    this.status = status;
    this.logs = logs;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  logs?: GatewayLogEntry[];
}

async function request<T>(
  apiPath: string,
  method: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(env.gatewayURL + apiPath, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new GatewayError(
      `网关不可达（${env.gatewayURL}）：${(err as Error).message}`,
      503,
    );
  }
  const json = (await res.json().catch(() => ({
    ok: false,
    error: `网关返回非 JSON（HTTP ${res.status}）`,
  }))) as Envelope<T>;
  if (!res.ok || json.ok === false) {
    throw new GatewayError(
      json.error ?? `网关错误（HTTP ${res.status}）`,
      res.status,
      json.logs,
    );
  }
  return json.data as T;
}

export const gateway = {
  health: () => request<{ status: string }>("/api/v1/health", "GET"),
  platforms: () => request<PlatformMetaDTO[]>("/api/v1/platforms", "GET"),
  sessions: () => request<GatewaySessionInfo[]>("/api/v1/sessions", "GET"),
  sessionInfo: (sid: string) =>
    request<{
      info: GatewaySessionInfo;
      session: Record<string, unknown>;
    }>(`/api/v1/sessions/${sid}`, "GET"),
  preflight: (body: {
    source: "ai" | "bank";
    ai?: { type: string; url: string; model: string; apiKey: string };
    questionBank?: { url: string; key: string };
  }) => request<{ available: boolean; error?: string }>("/api/v1/preflight", "POST", body),
  createSession: (payload: {
    platform: string;
    username: string;
    password: string;
    url?: string;
    cookie?: string;
    proxyURL?: string;
    loginTimeoutSeconds?: number;
    ai?: { enabled?: boolean; type: string; url: string; model: string; apiKey: string };
    questionBank?: { url: string; key: string };
  }) => request<GatewaySessionInfo>("/api/v1/sessions", "POST", payload),
  closeSession: (sid: string) => request<void>(`/api/v1/sessions/${sid}`, "DELETE"),
  courses: (sid: string) => request<GatewayCourse[]>(`/api/v1/sessions/${sid}/courses`, "GET"),
  profile: (sid: string) =>
    request<{ name: string }>(`/api/v1/sessions/${sid}/profile`, "GET"),
  tree: (sid: string, courseId: string) =>
    request<GatewayNode[]>(`/api/v1/sessions/${sid}/courses/${courseId}/tree`, "GET"),
  works: (sid: string, courseId: string) =>
    request<GatewayWork[]>(`/api/v1/sessions/${sid}/courses/${courseId}/works`, "GET"),
  exams: (sid: string, courseId: string) =>
    request<GatewayExam[]>(`/api/v1/sessions/${sid}/courses/${courseId}/exams`, "GET"),
  study: (
    sid: string,
    body: {
      courseId: string;
      nodeId: string;
      action?: string;
      mode?: string;
      positionSeconds?: number;
    },
  ) => request<GatewayStudyResult>(`/api/v1/sessions/${sid}/study`, "POST", body),
  doWork: (sid: string, body: { courseId: string; workId: string; source: string; submit: boolean }) =>
    request<GatewayAnswerResult>(`/api/v1/sessions/${sid}/works/do`, "POST", body),
  doExam: (sid: string, body: { courseId: string; examId: string; source: string; submit: boolean }) =>
    request<GatewayAnswerResult>(`/api/v1/sessions/${sid}/exams/do`, "POST", body),
  recentLogs: (sid: string) =>
    request<GatewayLogEntry[]>(`/api/v1/sessions/${sid}/logs/recent`, "GET"),
};
