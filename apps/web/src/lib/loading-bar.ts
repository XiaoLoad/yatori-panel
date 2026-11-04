import { computed, reactive } from "vue";

/**
 * 全局加载条状态：axios 拦截器与路由守卫共用计数。
 * count > 0 显示进度条；progress 0~100，到达 100 后自动隐藏。
 * 无真实进度可用，用「快启动慢收尾」的时间推进模拟（前端通行做法）。
 */
const state = reactive({
  count: 0,
  progress: 0,
  visible: false,
  timer: null as ReturnType<typeof setInterval> | null,
});

let hideTimer: ReturnType<typeof setTimeout> | null = null;

const visible = computed(() => state.visible);
const progress = computed(() => state.progress);

/** 计数 +1，首次开始模拟进度推进 */
function start(): void {
  state.count += 1;
  if (state.count > 1) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  state.progress = 8;
  state.visible = true;
  // 快速冲到 80%，然后减速逼近 90% 等待真实请求结束
  state.timer = setInterval(() => {
    const target = state.progress < 60 ? 12 : 3;
    state.progress = Math.min(90, state.progress + Math.max(0.6, (target - state.progress) * 0.12));
  }, 120);
}

/** 计数 -1，归零时冲到 100% 并淡出 */
function done(): void {
  state.count = Math.max(0, state.count - 1);
  if (state.count > 0) return;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.progress = 100;
  hideTimer = setTimeout(() => {
    state.visible = false;
    hideTimer = null;
    // 淡出后归零，下次从 8% 开始
    setTimeout(() => {
      if (!state.visible) state.progress = 0;
    }, 250);
  }, 220);
}

export function useLoadingBar() {
  return { visible, progress, start, done };
}
