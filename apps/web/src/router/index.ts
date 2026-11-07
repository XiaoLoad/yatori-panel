import { createRouter, createWebHistory } from "vue-router";
import AppShell from "@/components/layout/AppShell.vue";
import { useAuthStore } from "@/stores/auth";
import { setUnauthorizedHandler } from "@/api/client";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 };
  },
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue") },
    {
      path: "/",
      component: AppShell,
      children: [
        { path: "", name: "workspace", component: () => import("@/views/WorkspaceView.vue") },
        { path: "accounts", name: "accounts", component: () => import("@/views/AccountsView.vue") },
        {
          path: "accounts/:uid",
          name: "account",
          component: () => import("@/views/AccountDetailView.vue"),
          props: true,
        },
        { path: "history", name: "history", component: () => import("@/views/HistoryView.vue") },
        { path: "logs", name: "logs", component: () => import("@/views/LogsView.vue") },
        { path: "schedules", name: "schedules", component: () => import("@/views/SchedulesView.vue") },
        { path: "settings", name: "settings", component: () => import("@/views/SettingsView.vue") },
        // 兜底 404：挂在 AppShell children 内，顶栏导航与主题切换保持可用
        { path: ":pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue") },
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
      return true;
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
    return { name: "workspace" };
  }
  return true;
});
