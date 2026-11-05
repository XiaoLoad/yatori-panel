import { bus } from "./bus.ts";
import { env } from "./env.ts";
import { gateway, GatewayError, gatewayAuthHeaders } from "./gateway.ts";

/**
 * 网关状态机：后台心跳探测，状态变化经 SSE 广播。
 * detail 用于前端诊断提示：
 *  - conn refused（ECONNREFUSED）→ 进程未启动
 *  - timeout（ETIMEDOUT / 超时）→ 进程假死或网络阻塞
 *  - error → 其他异常（DNS 失败等）
 *
 * 迟滞设计：判「离线」需连续失败 DOWN_THRESHOLD 次（吸收网络抖动与
 * 事件循环阻塞导致的单次假超时），判「在线」一次成功立即恢复——
 * 误报离线的代价（用户恐慌）远高于漏报。
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
  /** 探测互斥锁：心跳与「重新检测」共用同一次探测，不并发、不回退旧快照 */
  probing: Promise<GatewayStatusEvent> | null;
  /** 连续失败计数；up 状态下 ≥ 阈值才判离线 */
  failStreak: number;
}

const DOWN_THRESHOLD = 3;

const state: State = { up: false, detail: "ok", probing: null, failStreak: 0 };

// 探测带独立超时（与心跳间隔对齐），避免网关假死时 fetch 长时间挂起；
// 放宽到 10s 吸收 node:sqlite 同步查询阻塞事件循环带来的假超时
async function probe(): Promise<{ up: boolean; detail: GatewayDetail }> {
  try {
    const res = await fetch(env.gatewayURL + "/api/v1/health", {
      headers: gatewayAuthHeaders(),
      signal: AbortSignal.timeout(10_000),
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

function applyResult(r: { up: boolean; detail: GatewayDetail }): GatewayStatusEvent {
  const prevUp = state.up;
  if (r.up) {
    state.failStreak = 0;
  } else {
    state.failStreak += 1;
  }
  // 判死需要连续失败达标；恢复一次成功即可
  const up = r.up || (prevUp && state.failStreak < DOWN_THRESHOLD);
  state.up = up;
  state.detail = r.up ? r.detail : (prevUp && up ? state.detail : r.detail);
  if (!up && prevUp) state.downAt = new Date().toISOString();
  if (up && !prevUp) {
    state.upAt = new Date().toISOString();
    state.downAt = undefined;
  }
  if (up !== prevUp) {
    bus.publish({
      type: "gateway.status",
      ts: Date.now(),
      up,
      detail: state.detail,
      message: up ? "网关已恢复在线" : describeDetail(state.detail),
    });
  }
  return snapshot();
}

/** 立即探测一次并更新状态；探测进行中则复用同一次探测的真实结果 */
export async function refreshGatewayStatus(): Promise<GatewayStatusEvent> {
  state.probing ??= (async () => {
    try {
      return applyResult(await probe());
    } finally {
      state.probing = null;
    }
  })();
  return state.probing;
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
