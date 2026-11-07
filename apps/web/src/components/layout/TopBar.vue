<script setup lang="ts">
import { LogOut, MonitorSmartphone, Moon, Settings, Sun } from "lucide-vue-next";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import GatewayBadge from "@/components/layout/GatewayBadge.vue";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { api } from "@/api/resources";
import { cn } from "@/lib/utils";

const NAV = [
  { name: "workspace", to: "/", label: "观测台" },
  { name: "accounts", to: "/accounts", label: "账号" },
  { name: "history", to: "/history", label: "台账" },
  { name: "logs", to: "/logs", label: "日志" },
  { name: "schedules", to: "/schedules", label: "定时" },
];

const route = useRoute();
const router = useRouter();
const theme = useThemeStore();
const auth = useAuthStore();
const active = computed(() => route.name as string);
const isActive = (name: string) =>
  name === "accounts" ? active.value === "accounts" || active.value === "account" : active.value === name;

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
  <header class="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-xl">
    <div class="mx-auto flex h-14 w-full max-w-[1480px] items-center gap-4 px-4 md:px-8">
      <RouterLink to="/" class="group flex shrink-0 items-center gap-3">
        <span class="relative grid size-8 place-items-center overflow-hidden rounded-lg border border-border bg-card">
          <span class="absolute inset-x-0 top-0 h-px bg-primary/60" />
          <span class="mono text-[13.5px] font-semibold tracking-tight text-primary">Y</span>
        </span>
        <span class="leading-none">
          <span class="display-title block text-[15px]">Yatori</span>
          <!-- 窄屏收起副标题，为状态区让位 -->
          <span class="mt-1 hidden text-[12px] text-muted-foreground md:block">刷课控制台</span>
        </span>
      </RouterLink>

      <!-- 桌面端顶部导航；移动端由底部标签栏承接 -->
      <nav class="ml-2 hidden h-14 items-stretch gap-1 md:flex">
        <RouterLink
          v-for="item in NAV"
          :key="item.name"
          :to="item.to"
          :class="cn(
            'relative flex items-center gap-1.5 px-3 text-[14.5px] transition-colors',
            isActive(item.name) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )"
        >
          {{ item.label }}
          <span
            v-if="isActive(item.name)"
            class="absolute inset-x-2 bottom-0 h-px bg-primary"
          />
        </RouterLink>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <GatewayBadge />
        <Button
          variant="ghost"
          size="icon"
          class="size-8 rounded-full"
          :title="`主题：${
            theme.mode === 'auto' ? '跟随系统' : theme.mode === 'light' ? '明亮' : '暗色'
          }（点击切换）`"
          @click="theme.cycle()"
        >
          <MonitorSmartphone v-if="theme.mode === 'auto'" class="size-4" />
          <Sun v-else-if="theme.mode === 'light'" class="size-4" />
          <Moon v-else class="size-4" />
        </Button>
        <RouterLink
          to="/settings"
          class="focus-ring grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :class="active === 'settings' ? 'bg-accent text-foreground' : ''"
          title="全局设置"
        >
          <Settings class="size-4" />
        </RouterLink>
        <Button
          v-if="auth.authRequired && auth.authed"
          variant="ghost"
          size="icon"
          class="size-8 rounded-full"
          title="退出登录"
          @click="logout"
        >
          <LogOut class="size-4" />
        </Button>
      </div>
    </div>
  </header>
</template>
