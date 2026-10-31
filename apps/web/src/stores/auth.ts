import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/api/resources";

// 访问锁状态：boot 时拉取一次，登录/登出后同步
export const useAuthStore = defineStore("auth", () => {
  const authRequired = ref(false);
  const authed = ref(true);
  const loaded = ref(false);

  async function refresh() {
    const s = await api.authStatus();
    authRequired.value = s.authRequired;
    authed.value = s.authed;
    loaded.value = true;
  }

  return { authRequired, authed, loaded, refresh };
});
