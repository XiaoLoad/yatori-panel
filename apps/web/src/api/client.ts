import axios from "axios";

export interface GatewayLogEntry {
  level: string;
  time: string;
  message: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  logs?: GatewayLogEntry[];
}

export class ApiError extends Error {
  logs?: GatewayLogEntry[];
  constructor(message: string, logs?: GatewayLogEntry[]) {
    super(message);
    this.logs = logs;
  }
}

const http = axios.create({ baseURL: "/api/v1", timeout: 120_000 });

// 服务端约定 200 + ok:false（如登录检测失败）与非 2xx（路由抛错）两种失败形态，统一归一
http.interceptors.response.use(
  (resp) => {
    const body = resp.data as Envelope<unknown> | undefined;
    if (body && body.ok === false) {
      throw new ApiError(body.error ?? "请求失败", body.logs);
    }
    return resp;
  },
  (err) => {
    const payload = err.response?.data as Envelope<unknown> | undefined;
    throw new ApiError(payload?.error ?? (err.message as string), payload?.logs);
  },
);

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const resp = await http.get<Envelope<T>>(url, { params });
  return resp.data.data as T;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const resp = await http.post<Envelope<T>>(url, body);
  return resp.data.data as T;
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const resp = await http.put<Envelope<T>>(url, body);
  return resp.data.data as T;
}

export async function del<T>(url: string): Promise<T> {
  const resp = await http.delete<Envelope<T>>(url);
  return resp.data.data as T;
}
