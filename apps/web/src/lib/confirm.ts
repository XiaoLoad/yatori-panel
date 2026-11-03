import { reactive } from "vue";

export type ConfirmTone = "danger" | "warning";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

/** 全局二次确认状态，由 ConfirmDialog 渲染 */
export const confirmState = reactive({
  open: false,
  title: "",
  description: "",
  confirmText: "确认",
  cancelText: "取消",
  tone: "warning" as ConfirmTone,
});

let pending: ((ok: boolean) => void) | null = null;

/** 统一的二次确认：返回 true 表示用户确认执行 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // 若已有未决确认，视为取消，避免回调悬挂
  pending?.(false);
  Object.assign(confirmState, {
    open: true,
    title: options.title,
    description: options.description ?? "",
    confirmText: options.confirmText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    tone: options.tone ?? "warning",
  });
  return new Promise<boolean>((resolve) => {
    pending = resolve;
  });
}

export function resolveConfirm(ok: boolean) {
  if (!confirmState.open) return;
  confirmState.open = false;
  const resolve = pending;
  pending = null;
  resolve?.(ok);
}
