<script setup lang="ts">
import {
  BookOpen,
  LayoutDashboard,
  ListChecks,
  Settings as SettingsIcon,
  Terminal,
  Users,
} from "lucide-vue-next";
import { useRoute } from "vue-router";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, exact: true },
  { to: "/accounts", label: "账号管理", icon: Users },
  { to: "/courses", label: "课程浏览", icon: BookOpen },
  { to: "/jobs", label: "任务控制台", icon: ListChecks },
  { to: "/logs", label: "实时日志", icon: Terminal },
  { to: "/settings", label: "全局设置", icon: SettingsIcon },
];

const route = useRoute();

function isActive(to: string, exact?: boolean) {
  return exact ? route.path === to : route.path.startsWith(to);
}
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
    <div class="flex h-14 items-center gap-2 border-b px-5">
      <div class="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BookOpen class="size-4" />
      </div>
      <span class="font-semibold">Yatori 面板</span>
    </div>
    <nav class="flex flex-1 flex-col gap-1 p-3">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive(item.to, item.exact)
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )"
      >
        <component :is="item.icon" class="size-4" />
        {{ item.label }}
      </RouterLink>
    </nav>
    <div class="border-t p-3 text-xs text-muted-foreground">
      v0.1.0-alpha · 仅监听本机
    </div>
  </aside>
</template>
