<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { post } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useEventStore } from "@/stores/events";

/**
 * 网关状态徽章：点击展开诊断面板——故障原因、修复指引、重新检测。
 * 状态数据来自 SSE gateway.status 事件（stores/events），事件缺失时回退"检测中"。
 */
const events = useEventStore();
const open = ref(false);
const rechecking = ref(false);
const wrap = ref<HTMLElement | null>(null);

const gs = computed(() => events.gatewayStatus);

const DETAIL_TEXT: Record<string, string> = {
  ok: "",
  "conn-refused": "网关进程未启动或端口未监听（连接被拒绝）",
  timeout: "网关长时间无响应（进程可能假死）",
  error: "网关连接异常（网络或 DNS 问题）",
};

const detailText = computed(() => DETAIL_TEXT[gs.value?.detail ?? "error"] ?? "网关连接异常");

async function recheck() {
  rechecking.value = true;
  try {
    const r = await post<{ gateway: string; detail: string }>("/health/recheck");
    if (r.gateway === "up") toast.success("网关已恢复在线");
    else toast.error(DETAIL_TEXT[r.detail] ?? "网关仍然离线");
  } catch {
    toast.error("面板服务不可达");
  } finally {
    rechecking.value = false;
  }
}

function onClickOutside(e: MouseEvent) {
  if (open.value && wrap.value && !wrap.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("click", onClickOutside));
onBeforeUnmount(() => document.removeEventListener("click", onClickOutside));
</script>

<template>
  <div ref="wrap" class="relative">
    <button
      class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
      :class="gs?.up
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'"
      title="点击查看网关诊断"
      @click="open = !open"
    >
      <span class="size-1.5 rounded-full" :class="gs?.up ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'" />
      <!-- 窄屏只留状态字，省出品牌区空间 -->
      <span class="hidden sm:inline">网关</span>{{ gs?.up ? "在线" : "离线" }}
    </button>

    <!-- 诊断面板 -->
    <div
      v-if="open"
      class="absolute end-0 top-9 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <p class="text-sm font-semibold">网关诊断</p>
      <template v-if="gs?.up">
        <p class="mt-2 text-xs text-muted-foreground">
          网关在线，登录、刷课功能正常可用。
        </p>
      </template>
      <template v-else>
        <p class="mt-2 text-xs leading-5 text-destructive">
          {{ detailText }}
        </p>
        <div class="mt-3 space-y-1 rounded-md bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
          <p class="font-medium text-foreground">修复指引：</p>
          <p>1. 双击项目目录下的 <code class="rounded bg-muted px-1">start.bat</code>，脚本会同时拉起网关与面板</p>
          <p>2. 或手动在项目根目录执行 <code class="rounded bg-muted px-1">bun run gateway:build &amp;&amp; bun run gateway:start</code></p>
          <p>3. Docker 部署时检查 <code class="rounded bg-muted px-1">docker compose ps</code> 中 gateway 容器状态</p>
        </div>
      </template>
      <Button
        variant="outline"
        size="sm"
        class="mt-3 w-full"
        :disabled="rechecking"
        @click="recheck"
      >
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': rechecking }" />
        {{ rechecking ? "检测中…" : "重新检测" }}
      </Button>
    </div>
  </div>
</template>
