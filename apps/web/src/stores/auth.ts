import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/api/resources";

// 访问锁状态：boot 时拉取一次，登录/登出后同步
export const useAuthStore = defineStore("auth", () => {
  const authRequired = ref(false);
  const authed = ref(true);
  const loaded = ref(false);
  /** 当前密码为系统生成的初始密码（登录后引导改密、免验旧密码） */
  const initialPassword = ref(false);
  /** 部署配置强制访问锁：生产环境不允许在运行时关闭 */
  const lockEnforced = ref(false);

  async function refresh() {
    const s = await api.authStatus();
    authRequired.value = s.authRequired;
    authed.value = s.authed;
    initialPassword.value = s.initialPassword;
    lockEnforced.value = s.lockEnforced;
    loaded.value = true;
  }

  return { authRequired, authed, loaded, initialPassword, lockEnforced, refresh };
});
