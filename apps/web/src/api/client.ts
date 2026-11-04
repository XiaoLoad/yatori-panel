import axios from "axios";

// 支持在请求 config 上声明 silent: true —— 后台轮询/保活类请求不驱动全局加载条
declare module "axios" {
  export interface AxiosRequestConfig {
    silent?: boolean;
  }
}

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
  /** 网关离线（server 返回 503 网关不可达）——前端据此做统一诊断提示与按钮禁用 */
  gatewayOffline?: boolean;
  constructor(message: string, logs?: GatewayLogEntry[], gatewayOffline?: boolean) {
    super(message);
    this.logs = logs;
    this.gatewayOffline = gatewayOffline;
  }
}

const http = axios.create({ baseURL: "/api/v1", timeout: 120_000 });

// 全局加载条：请求进出各计数一次；silent 请求（后台轮询）不计数，保持进出对称
import { useLoadingBar } from "@/lib/loading-bar";
const loadingBar = useLoadingBar();
http.interceptors.request.use((config) => {
  if (!config.silent) loadingBar.start();
  return config;
});

// 会话过期时统一踢回登录页（由 auth store 决定是否真的跳转）
export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}
let unauthorizedHandler: (() => void) | null = null;

// 服务端约定 200 + ok:false（如登录检测失败）与非 2xx（路由抛错）两种失败形态，统一归一
http.interceptors.response.use(
  (resp) => {
    if (!resp.config.silent) loadingBar.done();
    const body = resp.data as Envelope<unknown> | undefined;
    if (body && body.ok === false) {
      throw new ApiError(body.error ?? "请求失败", body.logs);
    }
    return resp;
  },
  (err) => {
    if (!err.config?.silent) loadingBar.done();
    const payload = err.response?.data as Envelope<unknown> | undefined;
    if (err.response?.status === 401) unauthorizedHandler?.();
    // server 侧 GatewayError 以 503（网关不可达）为主，统一打标供 UI 层分流
    const offline = err.response?.status === 503 || (payload?.error as string | undefined)?.includes("网关不可达");
    throw new ApiError(payload?.error ?? (err.message as string), payload?.logs, offline);
  },
);

export async function get<T>(
  url: string,
  params?: Record<string, unknown>,
  opts?: { silent?: boolean },
): Promise<T> {
  const resp = await http.get<Envelope<T>>(url, { params, ...opts });
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

export async function del<T>(url: string, body?: unknown): Promise<T> {
  const resp = await http.delete<Envelope<T>>(url, body === undefined ? undefined : { data: body });
  return resp.data.data as T;
}
