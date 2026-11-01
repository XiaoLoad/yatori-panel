<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Pencil,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from "lucide-vue-next";
import { computed, reactive, ref } from "vue";
import { toast } from "vue-sonner";
import type { AccountWithSession } from "@/api/resources";
import type { JobVO, StartJobBody } from "@yatori/shared";
import { api, type CourseDTO } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useEventStore } from "@/stores/events";
import { relativeTime } from "@/lib/utils";

const props = defineProps<{
  account: AccountWithSession;
  /** 该账号当前运行中的任务（无 = 空闲） */
  runningJob: JobVO | null;
}>();

const emit = defineEmits<{
  edit: [account: AccountWithSession];
  remove: [account: AccountWithSession];
  verify: [uid: string];
}>();

const queryClient = useQueryClient();
const events = useEventStore();
const expanded = ref(false);

// ---------- 课程进度（仅已有会话的账号拉取，不隐式登录） ----------
const hasSession = computed(() => props.account.hasSession);
const coursesQuery = useQuery({
  queryKey: computed(() => ["course-progress", props.account.uid]),
  queryFn: () => api.courses(props.account.uid),
  enabled: hasSession,
  refetchInterval: 30_000,
  staleTime: 60_000, // 60 秒内复用缓存，进页面不再干等
});

const stat = computed(() => {
  const list = coursesQuery.data.value ?? [];
  if (!list.length) return null;
  const done = list.filter((c) => c.progress >= 100).length;
  const avg = list.reduce((sum, c) => sum + Math.min(100, c.progress), 0) / list.length;
  return { done, total: list.length, avg };
});

// ---------- 发起 / 停止 ----------
// 不含 accountUid：启动时再与当前账号组合
const advanced: Pick<
  StartJobBody,
  "videoMode" | "answerSource" | "autoSubmit" | "perCourseConcurrency" | "courseIds"
> = reactive({
  videoMode: 1,
  answerSource: "off",
  autoSubmit: false,
  perCourseConcurrency: 4,
  courseIds: [],
});

function toggleCourse(course: CourseDTO) {
  const i = advanced.courseIds.indexOf(course.id);
  if (i >= 0) advanced.courseIds.splice(i, 1);
  else advanced.courseIds.push(course.id);
}

function toggleAllIncomplete() {
  const list = (coursesQuery.data.value ?? []).filter((c) => c.progress < 100);
  const all = list.every((c) => advanced.courseIds.includes(c.id));
  advanced.courseIds = all ? [] : list.map((c) => c.id);
}

const startMutation = useMutation({
  mutationFn: () =>
    api.startJob({
      accountUid: props.account.uid,
      courseIds: advanced.courseIds,
      videoMode: advanced.videoMode,
      answerSource: advanced.answerSource,
      autoSubmit: advanced.autoSubmit,
      perCourseConcurrency: advanced.perCourseConcurrency,
    }),
  onSuccess: () => {
    toast.success("任务已启动");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toast.error((err as Error).message),
});

function start() {
  startMutation.mutate();
}

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toast.error((err as Error).message),
});

const live = computed(() => (props.runningJob ? events.jobLive[props.runningJob.id] : undefined));
const liveProgress = computed(() => live.value?.lastProgress);

const modeText = computed(() =>
  ({ 1: "普通", 2: "暴力", 3: "去红" }[props.runningJob?.options.videoMode ?? 1] ?? ""),
);
const sourceText = computed(() =>
  ({ off: "不答题", ai: "AI 答题", bank: "题库答题" })[
    props.runningJob?.options.answerSource ?? "off"
  ] ?? "",
);

const videoModeModel = computed({
  get: () => String(advanced.videoMode),
  set: (v: string) => {
    advanced.videoMode = Number(v) as 1 | 2 | 3;
  },
});
const concurrencyModel = computed({
  get: () => String(advanced.perCourseConcurrency),
  set: (v: string) => {
    const n = Number(v);
    advanced.perCourseConcurrency = Math.min(16, Math.max(1, Number.isFinite(n) ? n : 1));
  },
});

const sourceOptions = [
  { value: "off", label: "不自动答题" },
  { value: "ai", label: "AI 答题（需在全局设置配置）" },
  { value: "bank", label: "外置题库（需在全局设置配置）" },
];
const modeOptions = [
  { value: "1", label: "普通模式（按顺序串行）" },
  { value: "2", label: "暴力模式（并发同刷，可能标红）" },
  { value: "3", label: "去红模式（重跑未完成节点）" },
];
</script>

<template>
  <Card>
    <CardContent class="p-5">
      <div class="flex flex-wrap items-start gap-5">
        <!-- 进度环 -->
        <div class="shrink-0">
          <div v-if="coursesQuery.isLoading.value && hasSession" class="flex items-center justify-center" :style="{ width: '104px', height: '104px' }">
            <Skeleton class="size-24 rounded-full" />
          </div>
          <div v-else class="relative inline-flex items-center justify-center" style="width: 104px; height: 104px">
            <svg width="104" height="104" class="-rotate-90">
              <circle cx="52" cy="52" r="45" fill="none" stroke="currentColor" class="text-primary/10" stroke-width="8" />
              <circle
                cx="52" cy="52" r="45" fill="none"
                stroke="url(#card-ring)" stroke-width="8" stroke-linecap="round"
                :stroke-dasharray="2 * Math.PI * 45"
                :stroke-dashoffset="2 * Math.PI * 45 * (1 - (stat?.avg ?? 0) / 100)"
                class="transition-all duration-700"
              />
              <defs>
                <linearGradient id="card-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#34d399" />
                  <stop offset="100%" stop-color="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-xl font-bold tabular-nums leading-none">{{ Math.round(stat?.avg ?? 0) }}%</span>
              <span class="mt-0.5 text-[11px] text-muted-foreground">平均进度</span>
            </div>
          </div>
        </div>

        <!-- 信息与操作 -->
        <div class="min-w-0 flex-1 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-lg font-semibold">{{ account.remark || account.username }}</span>
            <Badge variant="secondary">{{ account.platformName }}</Badge>
            <span
              v-if="account.sessionState === 'logging_in'"
              class="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-600 dark:text-sky-400"
            >
              <span class="size-1.5 animate-pulse rounded-full bg-sky-500" />
              登录中（验证码识别…）
            </span>
            <Badge v-if="account.lastVerifyOk === 1" variant="success">正常</Badge>
            <Badge v-else-if="account.lastVerifyOk === 0" variant="destructive">检测失败</Badge>
          </div>
          <div class="min-w-0 text-xs text-muted-foreground">
            <span class="truncate">{{ account.username }}</span>
            <span v-if="account.baseUrl"> · {{ account.baseUrl }}</span>
          </div>

          <div class="text-sm">
            <template v-if="stat">
              课程 {{ stat.total }} 门 · 完成 {{ stat.done }} 门
              <span class="text-muted-foreground">· 最近检测 {{ relativeTime(account.lastVerifyAt) }}</span>
            </template>
            <template v-else-if="hasSession">课程加载中…</template>
            <template v-else>
              <span class="text-muted-foreground">未登录——点击「检测」建立会话后可查看课程</span>
            </template>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <template v-if="!runningJob">
              <Button size="sm" :disabled="startMutation.isPending.value" @click="start()">
                <Play />开始刷课
              </Button>
              <Button variant="outline" size="sm" @click="expanded = !expanded">
                <Settings2 />高级选项
              </Button>
            </template>
            <template v-else>
              <Button variant="outline" size="sm" @click="stopMutation.mutate(runningJob.id)">
                <Square />停止任务
              </Button>
              <Badge variant="success">{{ modeText }}模式 · {{ sourceText }}</Badge>
            </template>
            <div class="ms-auto flex gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                title="登录检测"
                @click="emit('verify', account.uid)"
              >
                <RefreshCw class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" title="编辑" @click="emit('edit', account)">
                <Pencil class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="删除"
                class="text-destructive hover:text-destructive"
                @click="emit('remove', account)"
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- 运行中：实时进度 -->
      <div v-if="runningJob" class="mt-4 rounded-lg border bg-muted/30 p-4">
        <template v-if="liveProgress">
          <div class="mb-1.5 flex items-baseline justify-between gap-3">
            <p class="min-w-0 truncate text-sm">{{ liveProgress.nodeName }}</p>
            <span class="shrink-0 text-lg font-bold tabular-nums leading-none">
              {{ Math.round(liveProgress.progress ?? 0) }}%
            </span>
          </div>
          <Progress :model-value="liveProgress.progress ?? 0" class="h-2" />
          <p class="mt-2 text-xs text-muted-foreground">
            {{ liveProgress.courseName }} · 已观看 {{ liveProgress.watchedSeconds }}s /
            {{ liveProgress.totalSeconds || "?" }}s
          </p>
        </template>
        <p v-else class="text-sm text-muted-foreground">正在拉取课程与章节树…</p>
      </div>

      <!-- 高级选项 -->
      <div v-if="expanded && !runningJob" class="mt-4 space-y-4 rounded-lg border p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <Label>刷课模式</Label>
            <Select v-model="videoModeModel" :options="modeOptions" />
          </div>
          <div class="grid gap-2">
            <Label>答题来源</Label>
            <Select v-model="advanced.answerSource" :options="sourceOptions" />
          </div>
          <div v-if="advanced.videoMode === 2" class="grid gap-2">
            <Label>课程内并发数</Label>
            <Input v-model="concurrencyModel" type="number" min="1" max="16" />
          </div>
          <div class="flex items-end gap-3 pb-1">
            <Switch v-model="advanced.autoSubmit" />
            <Label class="font-normal">完成后自动提交</Label>
          </div>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label>课程范围</Label>
            <button
              v-if="(coursesQuery.data.value ?? []).some((c) => c.progress < 100)"
              class="text-xs text-muted-foreground underline-offset-2 hover:underline"
              @click="toggleAllIncomplete"
            >
              全选未完成 / 清空
            </button>
          </div>
          <div class="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
            <p v-if="!hasSession" class="p-1 text-xs text-muted-foreground">
              先登录检测建立会话，才能拉取课程列表
            </p>
            <p
              v-else-if="!(coursesQuery.data.value ?? []).length"
              class="p-1 text-xs text-muted-foreground"
            >
              该账号暂无课程
            </p>
            <label
              v-for="course in coursesQuery.data.value ?? []"
              :key="course.id"
              class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
            >
              <input
                type="checkbox"
                class="size-4"
                :checked="advanced.courseIds.includes(course.id)"
                :disabled="course.progress >= 100"
                @change="toggleCourse(course)"
              />
              <span class="min-w-0 flex-1 truncate">{{ course.name }}</span>
              <span class="text-xs tabular-nums text-muted-foreground">
                {{ Math.round(course.progress) }}%
              </span>
            </label>
          </div>
          <p class="text-xs text-muted-foreground">不勾选 = 刷全部课程；已完成的课程自动跳过</p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
