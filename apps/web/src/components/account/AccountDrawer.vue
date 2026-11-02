<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { BookOpen, ClipboardList, Pencil, RefreshCw, ScrollText, Square, Trash2, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { JobEvent, JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession, NodeDTO } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ProgressRing from "@/components/charts/ProgressRing.vue";
import ExamPanel from "@/components/account/ExamPanel.vue";
import { useEventStore } from "@/stores/events";
import { cn } from "@/lib/utils";

const props = defineProps<{
  account: AccountWithSession;
  job?: JobVO | null;
  progress?: JobEvent | null;
  schedule?: ScheduleVO | null;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  start: [];
  stop: [];
  verify: [];
  edit: [];
  remove: [];
}>();

const events = useEventStore();
const tab = ref<"courses" | "exams" | "logs">("courses");
const courseId = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) tab.value = "courses";
  },
);
watch(
  () => props.account.uid,
  () => {
    courseId.value = "";
  },
);

const coursesQuery = useQuery({
  queryKey: computed(() => ["drawer-courses", props.account.uid]),
  queryFn: () => api.courses(props.account.uid),
  enabled: computed(() => props.open),
  staleTime: 30_000,
});

watch(
  () => coursesQuery.data.value,
  (list) => {
    if (!courseId.value && list?.length) courseId.value = list[0]!.id;
  },
);

const treeQuery = useQuery({
  queryKey: computed(() => ["drawer-tree", props.account.uid, courseId.value]),
  queryFn: () => api.tree(props.account.uid, courseId.value),
  enabled: computed(() => props.open && !!courseId.value),
  staleTime: 30_000,
});

const currentCourse = computed(() => coursesQuery.data.value?.find((c) => c.id === courseId.value));

interface FlatNode {
  node: NodeDTO;
  depth: number;
}
const flatTree = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (nodes: NodeDTO[], depth: number) => {
    for (const n of nodes) {
      out.push({ node: n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(treeQuery.data.value ?? [], 0);
  return out;
});

const logs = computed(() => events.logs.filter((l) => l.accountId === props.account.uid).slice(-80));
const running = computed(() => props.job?.state === "running");
const percent = computed(() =>
  typeof props.progress?.progress === "number"
    ? Math.min(100, Math.max(0, Math.round(props.progress.progress)))
    : 0,
);
const phaseText = computed(() => {
  const map = { login: "登录", video: "视频", work: "作业", exam: "考试" } as const;
  return props.progress?.phase ? map[props.progress.phase] : running.value ? "准备" : "待机";
});

function duration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

const scheduleText = computed(() => {
  if (!props.schedule) return "NO SCHEDULE";
  const parts = props.schedule.cron.trim().split(/\s+/);
  const start =
    parts.length >= 2 ? `${parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}` : props.schedule.cron;
  return props.schedule.endTime ? `${start} → ${props.schedule.endTime}` : `${start} 开始`;
});

const TABS = [
  { key: "courses", label: "课程", icon: BookOpen },
  { key: "exams", label: "考试", icon: ClipboardList },
  { key: "logs", label: "日志", icon: ScrollText },
] as const;
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex justify-end">
    <div class="absolute inset-0 bg-black/55 backdrop-blur-[2px]" @click="emit('close')" />
    <aside
      class="relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-card shadow-[0_0_80px_-20px_rgba(0,0,0,0.8)]"
    >
      <header class="border-b border-border px-5 py-4">
        <div class="flex items-start gap-3">
          <div class="relative">
            <div class="grid size-11 place-items-center rounded-xl border border-border bg-panel-2 text-[15.5px] font-semibold text-primary">
              {{ (account.remark || account.username).slice(0, 1) }}
            </div>
            <span
              :class="cn(
                'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card',
                account.lastVerifyOk === 0 || account.sessionState === 'error' ? 'bg-coral' : 'bg-mint',
              )"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="truncate text-[17px] font-semibold">{{ account.remark || account.username }}</h2>
              <span class="mono rounded border border-border px-1 py-px text-[10.5px] uppercase text-muted-foreground">
                {{ account.platformName ?? account.platform }}
              </span>
            </div>
            <div class="mono mt-1 truncate text-[12px] text-muted-foreground">
              {{ account.username }} · {{ scheduleText }}
            </div>
          </div>
          <Button variant="ghost" size="icon" class="size-7" @click="emit('close')"><X class="size-4" /></Button>
        </div>

        <div class="mt-4 flex items-center gap-4">
          <ProgressRing :value="percent" :size="58" :stroke="5" :tone="running ? 'mint' : 'muted'" />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="stage-chip border-mint/30 bg-mint/10 text-mint">{{ phaseText }}</span>
              <span class="mono text-[12.5px] text-muted-foreground">{{ running ? "LIVE" : "IDLE" }}</span>
            </div>
            <div class="mt-1.5 truncate text-[14.5px]">
              {{ progress?.courseName || currentCourse?.name || "当前没有运行中的任务" }}
            </div>
            <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">
              <template v-if="progress?.watchedSeconds">
                已看 {{ duration(progress.watchedSeconds) }} / {{ progress.totalSeconds ? duration(progress.totalSeconds) : "?" }}
              </template>
              <template v-else>{{ progress?.nodeName || "等待事件" }}</template>
            </div>
          </div>
          <div class="flex shrink-0 flex-col gap-1.5">
            <Button
              v-if="running"
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-[13px]"
              @click="emit('stop')"
            ><Square class="size-3" />停止</Button>
            <Button v-else size="sm" class="h-7 text-[13px]" @click="emit('start')">开始任务</Button>
            <div class="flex items-center justify-center gap-0.5">
              <Button variant="ghost" size="icon" class="size-6" title="检测登录" @click="emit('verify')">
                <RefreshCw class="size-3" />
              </Button>
              <Button variant="ghost" size="icon" class="size-6" title="编辑账号" @click="emit('edit')">
                <Pencil class="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="size-6 text-muted-foreground hover:text-coral"
                title="删除账号"
                @click="emit('remove')"
              >
                <Trash2 class="size-3" />
              </Button>
            </div>
          </div>
        </div>

        <div class="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-mint transition-[width] duration-500" :style="{ width: `${percent}%` }" />
        </div>
      </header>

      <div class="flex gap-4 border-b border-border px-5">
        <button
          v-for="t in TABS"
          :key="t.key"
          :class="cn(
            'relative flex items-center gap-1.5 py-2 text-[13.5px] transition-colors',
            tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="tab = t.key"
        >
          <component :is="t.icon" class="size-3.5" />{{ t.label }}
          <span v-if="tab === t.key" class="absolute inset-x-0 bottom-0 h-px bg-primary" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-if="tab === 'courses'">
          <div v-if="coursesQuery.isLoading.value" class="space-y-2 p-5">
            <Skeleton v-for="i in 4" :key="i" class="h-10 w-full" />
          </div>
          <div v-else class="divide-y divide-border/60">
            <button
              v-for="course in coursesQuery.data.value ?? []"
              :key="course.id"
              :class="cn(
                'flex w-full flex-col gap-1.5 px-5 py-2.5 text-left transition-colors',
                courseId === course.id ? 'bg-primary/5' : 'hover:bg-accent/30',
              )"
              @click="courseId = course.id"
            >
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-[14px]">{{ course.name }}</span>
                <span class="mono text-[12px] text-muted-foreground">{{ Math.round(course.progress) }}%</span>
              </div>
              <div class="h-0.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-mint/70" :style="{ width: `${Math.round(course.progress)}%` }" />
              </div>
            </button>
          </div>

          <div v-if="courseId" class="border-t border-border px-5 py-4">
            <div class="mb-2 flex items-baseline justify-between">
              <span class="eyebrow">Chapter tree</span>
              <span class="mono text-[11.5px] text-muted-foreground">{{ flatTree.length }} 节点</span>
            </div>
            <div v-if="treeQuery.isLoading.value" class="space-y-1.5">
              <Skeleton v-for="i in 6" :key="i" class="h-6 w-full" />
            </div>
            <div v-else class="divide-y divide-border/40">
              <div
                v-for="item in flatTree"
                :key="item.node.id"
                class="flex items-center gap-2 py-1.5 text-[13.5px]"
                :class="item.node.children?.length ? 'font-medium text-foreground/90' : 'text-muted-foreground'"
                :style="{ paddingLeft: `${item.depth * 11}px` }"
              >
                <span
                  class="mono shrink-0 text-[11.5px]"
                  :class="item.node.completed ? 'text-mint' : item.node.progress > 0 ? 'text-amber' : 'text-muted-foreground/50'"
                >{{ item.node.completed ? "✓" : item.node.progress > 0 ? "▶" : "○" }}</span>
                <span class="min-w-0 flex-1 truncate">{{ item.node.name }}</span>
                <span class="mono shrink-0 text-[11.5px]">{{ duration(item.node.durationSeconds) }}</span>
              </div>
            </div>
          </div>
        </template>

        <ExamPanel v-else-if="tab === 'exams'" :account-uid="account.uid" :course-id="courseId" />

        <div v-else class="p-4">
          <div v-if="!logs.length" class="py-12 text-center text-[13.5px] text-muted-foreground">
            暂无日志，发起任务后会实时出现在这里
          </div>
          <div v-else class="space-y-1">
            <p v-for="(l, i) in logs" :key="i" class="flex items-baseline gap-2 font-mono text-[12.5px] leading-4">
              <span class="shrink-0 text-muted-foreground/60">{{ timeOf(l.ts) }}</span>
              <span
                :class="{
                  'text-amber': l.level === 'warn',
                  'text-coral': l.level === 'error',
                  'text-mint': l.level === 'info',
                  'text-muted-foreground': !l.level || l.level === 'debug',
                }"
              >{{ l.message }}</span>
            </p>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>
