import { createRouter, createWebHistory } from "vue-router";
import DefaultLayout from "@/components/layout/DefaultLayout.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
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
