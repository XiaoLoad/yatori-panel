import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

const STORAGE_KEY = "yatori-theme";

/** 主题模式：light / dark / 跟随系统 */
export type ThemeMode = "light" | "dark" | "auto";

function loadMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  // 旧版本只存过 "light"/"dark"，原样兼容
  if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  return "auto";
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(loadMode());
  const systemDark = ref(
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );

  // 跟随系统：系统切换明暗时实时生效
  if (typeof window !== "undefined") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", (e) => {
      systemDark.value = e.matches;
    });
  }

  // 监控面板以暗色为默认：auto 且系统未声明时按暗色渲染
  const dark = computed(() => (mode.value === "auto" ? systemDark.value : mode.value === "dark"));

  function apply() {
    document.documentElement.classList.toggle("dark", dark.value);
  }

  function setMode(next: ThemeMode) {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply();
  }

  /** 顶栏快捷按钮：在 auto → 明 → 暗 三档间循环 */
  function cycle() {
    setMode(mode.value === "auto" ? "light" : mode.value === "light" ? "dark" : "auto");
  }

  watch(dark, apply, { immediate: true });

  return { mode, dark, setMode, cycle };
});
