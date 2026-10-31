<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Moon, Sun } from "lucide-vue-next";
import { computed } from "vue";
import { useRoute } from "vue-router";
import { get } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/stores/theme";
import { useEventStream } from "@/composables/useEventStream";

const TITLES: Record<string, string> = {
  dashboard: "仪表盘",
  accounts: "账号管理",
  courses: "课程浏览",
  jobs: "任务控制台",
  logs: "实时日志",
  settings: "全局设置",
};

const route = useRoute();
const theme = useThemeStore();
useEventStream();

const { data: health } = useQuery({
  queryKey: ["health"],
  queryFn: () => get<{ status: string; gateway: string }>("/health"),
  refetchInterval: 10_000,
});

const title = computed(() => TITLES[route.name as string] ?? "");
const gatewayUp = computed(() => health.value?.gateway === "up");
</script>

<template>
  <header class="flex h-14 items-center justify-between border-b px-6">
    <h1 class="text-lg font-semibold">{{ title }}</h1>
    <div class="flex items-center gap-4">
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          :class="['size-2 rounded-full', gatewayUp ? 'bg-emerald-500' : 'bg-red-500']"
        />
        网关{{ gatewayUp ? "在线" : "离线" }}
      </span>
      <Button variant="ghost" size="icon" @click="theme.toggle()">
        <Sun v-if="theme.dark" class="size-4" />
        <Moon v-else class="size-4" />
      </Button>
    </div>
  </header>
</template>
