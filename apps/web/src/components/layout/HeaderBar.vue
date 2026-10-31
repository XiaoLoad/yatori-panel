<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { LogOut, Moon, Sun } from "lucide-vue-next";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { get } from "@/api/client";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useEventStream } from "@/composables/useEventStream";

const TITLES: Record<string, { title: string; desc: string }> = {
  dashboard: { title: "仪表盘", desc: "账号、会话与任务的总体状态" },
  accounts: { title: "账号管理", desc: "平台账号的添加、检测与备注" },
  courses: { title: "课程浏览", desc: "查看每门课与每个节点的学习进度" },
  jobs: { title: "任务控制台", desc: "发起刷课任务，实时跟踪进度" },
  logs: { title: "实时日志", desc: "任务与服务的运行日志流" },
  settings: { title: "全局设置", desc: "AI 答题、题库与调度参数" },
};

const route = useRoute();
const theme = useThemeStore();
useEventStream();

const { data: health } = useQuery({
  queryKey: ["health"],
  queryFn: () => get<{ status: string; gateway: string }>("/health"),
  refetchInterval: 10_000,
});

const meta = computed(() => TITLES[route.name as string] ?? { title: "", desc: "" });
const gatewayUp = computed(() => health.value?.gateway === "up");
const auth = useAuthStore();
const router = useRouter();

async function logout() {
  try {
    await api.logout();
  } finally {
    auth.authed = false;
    toast.success("已退出");
    router.push("/login");
  }
}
</script>

<template>
  <header class="sticky top-0 z-40 flex h-14 items-center justify-end gap-2 border-b bg-background/80 px-6 backdrop-blur-md">
    <span class="me-auto text-xs text-muted-foreground">{{ meta.desc }}</span>
    <div class="flex items-center gap-2">
      <span
        class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
        :class="gatewayUp
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'"
      >
        <span class="size-1.5 rounded-full" :class="gatewayUp ? 'bg-emerald-500' : 'bg-red-500'" />
        网关{{ gatewayUp ? "在线" : "离线" }}
      </span>
      <Button variant="ghost" size="icon" @click="theme.toggle()">
        <Sun v-if="theme.dark" class="size-4" />
        <Moon v-else class="size-4" />
      </Button>
      <Button
        v-if="auth.authRequired && auth.authed"
        variant="ghost"
        size="icon"
        title="退出登录"
        @click="logout"
      >
        <LogOut class="size-4" />
      </Button>
    </div>
  </header>
</template>
