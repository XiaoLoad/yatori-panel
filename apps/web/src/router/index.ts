import { createRouter, createWebHistory } from "vue-router";
import DefaultLayout from "@/components/layout/DefaultLayout.vue";
import { useAuthStore } from "@/stores/auth";
import { setUnauthorizedHandler } from "@/api/client";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue") },
    {
      path: "/",
      component: DefaultLayout,
      children: [
        { path: "", name: "dashboard", component: () => import("@/views/DashboardView.vue") },
        { path: "accounts", name: "accounts", component: () => import("@/views/AccountsView.vue") },
        { path: "courses", name: "courses", component: () => import("@/views/CourseTreeView.vue") },
        { path: "jobs", name: "jobs", component: () => import("@/views/JobsView.vue") },
        { path: "logs", name: "logs", component: () => import("@/views/LogsView.vue") },
        { path: "settings", name: "settings", component: () => import("@/views/SettingsView.vue") },
      ],
    },
  ],
});

// 访问锁守卫：仅当面板设置了密码时生效；会话过期由 401 拦截器兜底
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) {
    try {
      await auth.refresh();
    } catch {
      return true; // 状态接口异常时不拦截，交给各页面自身的错误处理
    }
    setUnauthorizedHandler(() => {
      auth.authed = false;
      if (auth.authRequired) void router.push("/login");
    });
  }
  if (auth.authRequired && !auth.authed && to.name !== "login") {
    return { name: "login" };
  }
  if (to.name === "login" && (!auth.authRequired || auth.authed)) {
    return { name: "dashboard" };
  }
  return true;
});
