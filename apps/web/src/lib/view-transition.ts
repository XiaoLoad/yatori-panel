/**
 * View Transitions API 轻量封装：不支持时自动降级为直接执行回调，
 * prefers-reduced-motion 用户同样跳过动画。
 *
 * 浏览器支持：Chrome/Edge 111+、Firefox 141+、Safari 18+。
 * 降级路径与项目既有 reduceMotion 模式一致——功能不受影响，只是没有过渡。
 */

import { ref } from "vue";

/** 是否应跳过过渡：API 不存在或用户偏好减弱动效 */
export function viewTransitionSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof document.startViewTransition !== "function") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return true;
}

/**
 * VT 过渡进行中的全局标记：VT 会把 view-transition-name 元素提升到根层叠
 * 上下文渲染快照，与 GSAP 页面进入动画同时跑会互相竞争（闪烁/盖层）。
 * AppShell 检测到此标记时跳过一次 GSAP 编排，把页面切换动画完全交给 VT。
 */
let vtActive = false;

export function isViewTransitionActive(): boolean {
  return vtActive;
}

/**
 * 共享元素瞬态命名：view-transition-name 是文档级的——只要元素带命名，
 * 任何 VT（包括与它无关的分段切换）都会把它提升到根层单独做组动画。
 * 因此命名只在「列表 → 详情」跳转窗口内激活：
 * 列表行点击时 markSharedElement(uid) → 双端快照配对 → 过渡结束即清除，
 * 详情页后续的分段切换不再携带头像。
 */
const sharedUid = ref("");

export function markSharedElement(uid: string): void {
  sharedUid.value = uid;
}

export function clearSharedElement(): void {
  sharedUid.value = "";
}

/** 账号头像共享样式：仅当前导航目标账号在过渡窗口内时生效 */
export function accountSharedStyle(uid: string): { viewTransitionName: string } | undefined {
  return sharedUid.value === uid ? { viewTransitionName: `account-avatar-${uid}` } : undefined;
}

/**
 * 在视图过渡中执行 DOM 更新；不支持时直接同步执行。
 * 返回过渡完成信号（降级时立即 resolve）。
 */
export function withViewTransition(update: () => void | Promise<void>): Promise<void> {
  if (!viewTransitionSupported()) {
    void update();
    return Promise.resolve();
  }
  vtActive = true;
  return document
    .startViewTransition(update)
    .finished.catch(() => {
      // 过渡被跳过（如 Tab 切后台）不算错误
    })
    .finally(() => {
      vtActive = false;
      // 共享元素命名只存活一个过渡窗口，避免残留命名被后续无关 VT 捕获
      clearSharedElement();
    });
}
