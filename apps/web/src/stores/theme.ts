import { defineStore } from "pinia";
import { ref } from "vue";

const STORAGE_KEY = "yatori-theme";

export const useThemeStore = defineStore("theme", () => {
  const dark = ref(localStorage.getItem(STORAGE_KEY) === "dark");

  function apply() {
    document.documentElement.classList.toggle("dark", dark.value);
  }

  function toggle() {
    dark.value = !dark.value;
    localStorage.setItem(STORAGE_KEY, dark.value ? "dark" : "light");
    apply();
  }

  apply();
  return { dark, toggle };
});
