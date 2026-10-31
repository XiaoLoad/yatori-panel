<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { api, type AccountWithSession } from "@/api/resources";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const props = defineProps<{ account: AccountWithSession }>();

// 仅对已有会话的账号拉取进度，避免页面加载时隐式登录全部账号
const hasSession = computed(() => props.account.hasSession);
const q = useQuery({
  queryKey: computed(() => ["course-progress", props.account.uid]),
  queryFn: () => api.courses(props.account.uid),
  enabled: hasSession,
  refetchInterval: 30_000,
});

const stat = computed(() => {
  const list = q.data.value ?? [];
  if (!list.length) return null;
  const done = list.filter((c) => c.progress >= 100).length;
  const avg = list.reduce((sum, c) => sum + Math.min(100, c.progress), 0) / list.length;
  return { done, total: list.length, avg };
});
</script>

<template>
  <div v-if="!hasSession" class="text-xs text-muted-foreground">未登录</div>
  <div v-else-if="q.isLoading.value" class="flex items-center gap-2 pr-2">
    <Skeleton class="h-1.5 flex-1" />
    <Skeleton class="h-3 w-12" />
  </div>
  <div v-else-if="!stat" class="pr-2 text-xs text-muted-foreground">无课程</div>
  <div v-else class="pr-2">
    <div class="mb-1 flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{{ stat.done }}/{{ stat.total }} 门完成</span>
      <span class="font-medium tabular-nums">{{ Math.round(stat.avg) }}%</span>
    </div>
    <Progress :model-value="stat.avg" class="h-1.5" />
  </div>
</template>
