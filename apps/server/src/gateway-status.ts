import { bus } from "./bus.ts";
import { env } from "./env.ts";
import { gateway, GatewayError } from "./gateway.ts";

/**
 * 网关状态机：后台心跳探测，状态变化经 SSE 广播。
 * detail 用于前端诊断提示：
 *  - conn refused（ECONNREFUSED）→ 进程未启动
 *  - timeout（ETIMEDOUT / 5s 超时）→ 进程假死或网络阻塞
 *  - error → 其他异常（DNS 失败等）
 */
export type GatewayDetail = "ok" | "conn-refused" | "timeout" | "error";

export interface GatewayStatusEvent {
  up: boolean;
  detail: GatewayDetail;
  /** 最近一次 up→down 的 ISO 时间 */
  downAt?: string;
  /** 最近一次 down→up 的 ISO 时间 */
  upAt?: string;
}

interface State {
  up: boolean;
  detail: GatewayDetail;
  downAt?: string;
  upAt?: string;
  probing: boolean;
}

const state: State = { up: false, detail: "ok", probing: false };

// 探测带独立超时，避免网关假死时 fetch 长时间挂起
async function probe(): Promise<{ up: boolean; detail: GatewayDetail }> {
  try {
    const res = await fetch(env.gatewayURL + "/api/v1/health", {
      signal: AbortSignal.timeout(5_000),
    });
    await res.body?.cancel();
    if (res.ok) return { up: true, detail: "ok" };
    return { up: false, detail: "error" };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const code = e.cause?.code ?? (e as { code?: string }).code;
    if (code === "ECONNREFUSED") return { up: false, detail: "conn-refused" };
    if (code === "ETIMEDOUT" || e.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return { up: false, detail: "timeout" };
    }
    return { up: false, detail: "error" };
  }
}

function classify(err: unknown): GatewayDetail {
  if (err instanceof GatewayError) {
    if (err.message.includes("ECONNREFUSED") || err.status === 503) return "conn-refused";
    if (err.status === 504) return "timeout";
  }
  return "error";
}

/** 立即探测一次并更新状态（health 接口与前端"重新检测"共用） */
export async function refreshGatewayStatus(): Promise<GatewayStatusEvent> {
  if (state.probing) return snapshot();
  state.probing = true;
  try {
    const r = await probe();
    const prevUp = state.up;
    state.up = r.up;
    state.detail = r.detail;
    if (!r.up && prevUp) state.downAt = new Date().toISOString();
    if (r.up && !prevUp) {
      state.upAt = new Date().toISOString();
      state.downAt = undefined;
    }
    if (r.up !== prevUp) {
      bus.publish({
        type: "gateway.status",
        ts: Date.now(),
        up: r.up,
        detail: r.detail,
        message: r.up ? "网关已恢复在线" : describeDetail(r.detail),
      });
    }
    return snapshot();
  } finally {
    state.probing = false;
  }
}

export function snapshot(): GatewayStatusEvent {
  return { up: state.up, detail: state.detail, downAt: state.downAt, upAt: state.upAt };
}

export function describeDetail(d: GatewayDetail): string {
  switch (d) {
    case "conn-refused":
      return "网关进程未启动或端口未监听（连接被拒绝）";
    case "timeout":
      return "网关长时间无响应（进程可能假死）";
    default:
      return "网关连接异常";
  }
}

export function startGatewayWatch(intervalMs = 10_000): void {
  // 启动先立即探测一次，之后周期心跳
  void refreshGatewayStatus();
  setInterval(() => void refreshGatewayStatus().catch(() => {}), intervalMs);
}

export { classify as classifyGatewayError };
