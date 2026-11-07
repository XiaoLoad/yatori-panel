<script setup lang="ts">
import { History, Logs, Radio, Users, Waypoints } from "lucide-vue-next";
import { computed } from "vue";
import { useRoute } from "vue-router";

/**
 * 移动端底部标签栏（<md 显示）：观测台/账号/台账/日志/定时。
 * 桌面导航在 TopBar；此处为移动端拇指可达的原生 tab 范式。
 * 安全区：padding-bottom 吸收 iOS home indicator（env safe-area）。
 */
const ITEMS = [
  { name: "workspace", to: "/", label: "观测台", icon: Radio },
  { name: "accounts", to: "/accounts", label: "账号", icon: Users },
  { name: "history", to: "/history", label: "台账", icon: History },
  { name: "logs", to: "/logs", label: "日志", icon: Logs },
  { name: "schedules", to: "/schedules", label: "定时", icon: Waypoints },
];

const route = useRoute();
const active = computed(() => route.name as string);
const isActive = (name: string) =>
  name === "accounts" ? active.value === "accounts" || active.value === "account" : active.value === name;
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-xl md:hidden"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <div class="grid h-[56px] grid-cols-5">
      <RouterLink
        v-for="item in ITEMS"
        :key="item.name"
        :to="item.to"
        class="relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] leading-none transition-colors"
        :class="isActive(item.name) ? 'text-primary' : 'text-muted-foreground'"
      >
        <component :is="item.icon" class="size-[18px]" />
        {{ item.label }}
        <span
          v-if="isActive(item.name)"
          class="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
        />
      </RouterLink>
    </div>
  </nav>
</template>
