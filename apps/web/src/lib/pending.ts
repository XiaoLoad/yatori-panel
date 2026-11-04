import { reactive } from "vue";

/**
 * 关键操作的进行中锁：防止确认弹窗关闭后、请求返回前用户重复点击。
 * 以操作标识（如 `stop:${jobId}`）为 key，统一登记与释放。
 */
const locks = reactive<Record<string, boolean>>({});

export function isPending(key: string): boolean {
  return locks[key] === true;
}

/** 执行期间加锁；返回 false 表示同key操作已在进行中，应跳过本次触发 */
export function runPending(key: string, fn: () => Promise<unknown> | unknown): boolean {
  if (locks[key]) return false;
  locks[key] = true;
  void Promise.resolve(fn()).finally(() => {
    delete locks[key];
  });
  return true;
}
