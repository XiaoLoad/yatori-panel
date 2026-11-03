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
  /** 创建会话时 AI/题库配置指纹（sha256 前 16 位，空配置为空串） */
  configFingerprint?: string;
}

export interface GatewayLogEntry {
  level: string;
  time: string;
  message: string;
}

/** 逐题考试进度事件（网关 exams/detail SSE） */
export interface GatewayExamProgress {
  index: number;
  total: number;
  type: string;
  content: string;
  answer: string[];
  blank: boolean;
  hit: boolean;
  savedMsg?: string;
  err?: string;
}

/** 逐题考试最终结果 */
export interface GatewayExamDetailResult {
  submitted: boolean;
  total: number;
  answered: number;
  blank: number;
  answers: {
    index: number;
    type: string;
    content: string;
    value: string[];
    blank: boolean;
    hit: boolean;
  }[];
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

/** 单次网关请求的默认超时：防止网关侧挂起把调用方无限拖住 */
const DEFAULT_TIMEOUT_MS = 30_000;

interface RequestOptions {
  /** 调用方中断信号（如任务停止）；与超时取并集，任一触发即中断 */
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(
  apiPath: string,
  method: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  // 超时与调用方 signal 合并：停止任务时进行中的请求立即中断，不再等它自然结束
  const signal = AbortSignal.any([
    AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(opts?.signal ? [opts.signal] : []),
  ]);
  let res: Response;
  try {
    res = await fetch(env.gatewayURL + apiPath, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw new GatewayError(
        `网关请求超时（${apiPath}，${((opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000).toFixed(0)}s）`,
        504,
      );
    }
    if ((err as Error).name === "AbortError") {
      throw new GatewayError(`网关请求已中止（${apiPath}）`, 499);
    }
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
  createSession: (
    payload: {
      platform: string;
      username: string;
      password: string;
      url?: string;
      cookie?: string;
      proxyURL?: string;
      loginTimeoutSeconds?: number;
      /** 面板侧配置指纹：网关原样存入 sessionInfo，复用会话时比对 */
      configFingerprint?: string;
      ai?: { enabled?: boolean; type: string; url: string; model: string; apiKey: string };
      questionBank?: { url: string; key: string };
    },
    opts?: RequestOptions,
  ) => request<GatewaySessionInfo>("/api/v1/sessions", "POST", payload, opts),
  closeSession: (sid: string, opts?: RequestOptions) =>
    request<void>(`/api/v1/sessions/${sid}`, "DELETE", undefined, opts),
  courses: (sid: string, opts?: RequestOptions) =>
    request<GatewayCourse[]>(`/api/v1/sessions/${sid}/courses`, "GET", undefined, opts),
  profile: (sid: string, opts?: RequestOptions) =>
    request<{ name: string }>(`/api/v1/sessions/${sid}/profile`, "GET", undefined, opts),
  tree: (sid: string, courseId: string, opts?: RequestOptions) =>
    request<GatewayNode[]>(
      `/api/v1/sessions/${sid}/courses/${courseId}/tree`,
      "GET",
      undefined,
      opts,
    ),
  works: (sid: string, courseId: string, opts?: RequestOptions) =>
    request<GatewayWork[]>(
      `/api/v1/sessions/${sid}/courses/${courseId}/works`,
      "GET",
      undefined,
      opts,
    ),
  exams: (sid: string, courseId: string, opts?: RequestOptions) =>
    request<GatewayExam[]>(
      `/api/v1/sessions/${sid}/courses/${courseId}/exams`,
      "GET",
      undefined,
      opts,
    ),
  study: (
    sid: string,
    body: {
      courseId: string;
      nodeId: string;
      action?: string;
      mode?: string;
      positionSeconds?: number;
      /** 视频总时长（秒）：网关据此计算进度，英华直连学时接口时需要 */
      durationSeconds?: number;
    },
    opts?: RequestOptions,
  ) => request<GatewayStudyResult>(`/api/v1/sessions/${sid}/study`, "POST", body, opts),
  doWork: (
    sid: string,
    body: { courseId: string; workId: string; source: string; submit: boolean },
    opts?: RequestOptions,
  ) =>
    // AI/题库逐题作答耗时长，单独放宽超时
    request<GatewayAnswerResult>(`/api/v1/sessions/${sid}/works/do`, "POST", body, {
      ...opts,
      timeoutMs: opts?.timeoutMs ?? 600_000,
    }),
  doExam: (
    sid: string,
    body: { courseId: string; examId: string; source: string; submit: boolean },
    opts?: RequestOptions,
  ) =>
    request<GatewayAnswerResult>(`/api/v1/sessions/${sid}/exams/do`, "POST", body, {
      ...opts,
      timeoutMs: opts?.timeoutMs ?? 600_000,
    }),
  /**
   * 逐题模式考试（SSE）：onProgress 每题回调，resolve 于最终 result。
   * 仅英华支持；网关不支持/出错时 reject（错误信息含网关 error 事件）。
   */
  examDetail: (
    sid: string,
    body: { courseId: string; examId: string; nodeId: string; bankUrl: string; submitMode: string },
    onProgress: (p: GatewayExamProgress) => void,
    opts?: RequestOptions,
  ): Promise<GatewayExamDetailResult> =>
    new Promise((resolve, reject) => {
      void (async () => {
        let res: Response;
        try {
          res = await fetch(`${env.gatewayURL}/api/v1/sessions/${sid}/exams/detail`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            // SSE 长连接：跟随调用方 signal，超时只做极端兜底（30 分钟）
            signal: AbortSignal.any([
              AbortSignal.timeout(opts?.timeoutMs ?? 1_800_000),
              ...(opts?.signal ? [opts.signal] : []),
            ]),
          });
        } catch (err) {
          reject(new GatewayError(`网关不可达（${env.gatewayURL}）：${(err as Error).message}`, 503));
          return;
        }
        if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          reject(new GatewayError(j.error ?? `网关错误（HTTP ${res.status}）`, res.status));
          return;
        }
        if (!res.body) {
          reject(new GatewayError("网关未返回 SSE 流", 502));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = "";
            let data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event: ")) event = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!event || !data) continue;
            try {
              const parsed = JSON.parse(data);
              if (event === "progress") onProgress(parsed as GatewayExamProgress);
              else if (event === "result") resolve(parsed as GatewayExamDetailResult);
              else if (event === "error") reject(new GatewayError(parsed.error ?? "逐题答题失败", 500));
            } catch {
              /* 忽略不完整帧 */
            }
          }
        }
      })();
    }),
  recentLogs: (sid: string) =>
    request<GatewayLogEntry[]>(`/api/v1/sessions/${sid}/logs/recent`, "GET"),
};
