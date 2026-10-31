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

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "概览",
    items: [{ to: "/", label: "仪表盘", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "刷课",
    items: [
      { to: "/accounts", label: "账号管理", icon: Users },
      { to: "/courses", label: "课程浏览", icon: BookOpen },
      { to: "/jobs", label: "任务控制台", icon: ListChecks },
    ],
  },
  {
    label: "系统",
    items: [
      { to: "/logs", label: "实时日志", icon: Terminal },
      { to: "/settings", label: "全局设置", icon: SettingsIcon },
    ],
  },
];

const route = useRoute();

function isActive(to: string, exact?: boolean) {
  return exact ? route.path === to : route.path.startsWith(to);
}
</script>

<template>
  <aside class="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
    <div class="flex h-14 items-center gap-2.5 border-b px-4">
      <div class="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BookOpen class="size-4" />
      </div>
      <div class="leading-tight">
        <div class="text-sm font-semibold">Yatori 面板</div>
        <div class="text-[11px] text-muted-foreground">课程助手控制台</div>
      </div>
    </div>

    <nav class="flex-1 space-y-4 overflow-y-auto p-3">
      <div v-for="group in groups" :key="group.label">
        <div class="mb-1.5 px-2 text-[11px] font-medium tracking-wide text-muted-foreground/80">
          {{ group.label }}
        </div>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          :class="cn(
            'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            isActive(item.to, item.exact)
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )"
        >
          <component :is="item.icon" class="size-4" />
          {{ item.label }}
        </RouterLink>
      </div>
    </nav>

    <div class="border-t p-3">
      <div class="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
        <span
          class="relative flex size-2"
        >
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        服务运行中 · v0.6.0
      </div>
    </div>
  </aside>
</template>
