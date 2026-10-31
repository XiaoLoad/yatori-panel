<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Eraser } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { api } from "@/api/resources";
import type { JobEvent } from "@yatori/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useEventStore } from "@/stores/events";

const events = useEventStore();
const accountsQuery = useQuery({
  queryKey: ["accounts"],
  queryFn: api.accounts,
});

const accountFilter = ref("");
// 默认 INFO 及以上：DEBUG 级是逐次学时提交的高频行，按需切换查看
const levelFilter = ref("info");
const keyword = ref("");

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const filtered = computed(() => {
  let list = events.logs;
  if (accountFilter.value) {
    list = list.filter((e) => e.accountId === accountFilter.value);
  }
  if (levelFilter.value) {
    const min = LEVEL_RANK[levelFilter.value] ?? 0;
    list = list.filter((e) => (LEVEL_RANK[e.level ?? "info"] ?? 1) >= min);
  }
  const kw = keyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter((e) => (e.message ?? "").toLowerCase().includes(kw));
  }
  return list;
});

// 有新日志时贴底滚动；用户上翻浏览时保持位置
const scroller = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

watch(
  () => filtered.value.length,
  () => {
    if (!stickToBottom.value) return;
    nextTick(() => {
      const el = scroller.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function levelColor(level?: string) {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-300";
    case "debug":
      return "text-zinc-500";
    default:
      return "text-emerald-300";
  }
}

function line(e: JobEvent) {
  return `[${e.ts ? new Date(e.ts).toLocaleTimeString() : "--:--:--"}] ${e.message ?? ""}`;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <Select
        v-model="accountFilter"
        class="max-w-56"
        :options="[
          { value: '', label: '全部账号' },
          ...(accountsQuery.data.value ?? []).map((a) => ({
            value: a.uid,
            label: `${a.platformName} · ${a.username}`,
          })),
        ]"
      />
      <Select
        v-model="levelFilter"
        class="max-w-36"
        :options="[
          { value: 'error', label: 'ERROR' },
          { value: 'warn', label: 'WARN 及以上' },
          { value: 'info', label: 'INFO 及以上' },
          { value: '', label: '全部（含 DEBUG）' },
        ]"
      />
      <Input v-model="keyword" placeholder="关键字过滤" class="max-w-64" />
      <Button variant="outline" size="sm" @click="events.logs = []">
        <Eraser />清空
      </Button>
    </div>

    <Card class="overflow-hidden py-0">
      <CardContent class="px-0">
        <div
          ref="scroller"
          class="h-[calc(100vh-16rem)] min-h-96 overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-5"
          @scroll="onScroll"
        >
          <p v-if="!filtered.length" class="text-zinc-500">
            暂无日志 —— 面板后端与网关的运行日志会实时出现在这里
          </p>
          <p
            v-for="(e, i) in filtered"
            :key="e.ts + '-' + i"
            :class="levelColor(e.level)"
          >
            {{ line(e) }}
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
