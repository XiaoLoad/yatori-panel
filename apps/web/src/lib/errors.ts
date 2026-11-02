import { toast } from "vue-sonner";
import { ApiError } from "@/api/client";

/**
 * 统一错误 toast：网关离线时给出"去诊断"的明确指引，其余透传原始消息。
 * 用于任务发起、账号检测/添加等所有触达网关的操作。
 */
export function toastError(err: unknown, fallback: string): void {
  if (err instanceof ApiError && err.gatewayOffline) {
    toast.error("网关离线——请点击右上角网关徽章查看诊断与修复指引");
    return;
  }
  toast.error((err as Error)?.message || fallback);
}
