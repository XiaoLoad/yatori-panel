<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, ChevronRight, Plus, Search, StopCircle } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { JobEvent, JobState, JobVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AddAccountDialog from "@/components/account/AddAccountDialog.vue";
import DailyTrend from "@/components/charts/DailyTrend.vue";
import Sparkline from "@/components/charts/Sparkline.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { formatDuration, formatEta, jobStateLabel, overallPercent, phaseLabel, progressDetail } from "@/lib/account";
import { cn } from "@/lib/utils";

const router = useRouter();
const queryClient = useQueryClient();
const events = useEventStore();

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 80 }),
  refetchInterval: 5_000,
});
const statsQuery = useQuery({
  queryKey: ["stats", 14],
  queryFn: () => api.statsDaily(14),
  refetchInterval: 60_000,
});
const historyLogsQuery = useQuery({
  queryKey: ["logs", 300],
  queryFn: () => api.logEvents(300),
  refetchInterval: 15_000,
});

// ---------- 全站任务 ----------
const jobs = computed(() => jobsQuery.data.value ?? []);

const runningJobs = computed(() =>
  jobs.value
    .filter((j) => j.state === "running")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
);

const runningAccountCount = computed(
  () => new Set(runningJobs.value.map((j) => j.accountUid)).size,
);

const accountByUid = computed<Record<string, AccountWithSession>>(() => {
  const map: Record<string, AccountWithSession> = {};
  for (const a of accountsQuery.data.value ?? []) map[a.uid] = a;
  return map;
});
const accountLabel = (uid?: string) => {
  if (!uid) return "系统";
  const a = accountByUid.value[uid];
  return a ? a.remark || a.username : uid.slice(0, 6);
};

function liveProgress(job: JobVO): JobEvent | null {
  return events.jobLive[job.id]?.lastProgress ?? job.progress ?? null;
}

/** 运行中任务卡片：账号 + 整体进度 + 每门课程的独立进度 */
const runningCards = computed(() =>
  runningJobs.value.map((job) => {
    const progress = liveProgress(job);
    return {
      job,
      progress,
      overall: overallPercent(progress),
      courses: progress?.coursesProgress ?? [],
    };
  }),
);

// ---------- 统计 ----------
const stats = computed(() => statsQuery.data.value ?? []);
const today = computed(() => stats.value[stats.value.length - 1]);
const yesterday = computed(() => stats.value[stats.value.length - 2]);
const videoSpark = computed(() => stats.value.map((d) => d.videos));

const videoDelta = computed(() => {
  if (!today.value || !yesterday.value) return null;
  const diff = today.value.videos - yesterday.value.videos;
  if (yesterday.value.videos === 0) return diff > 0 ? "+100%" : "—";
  return `${diff >= 0 ? "+" : ""}${Math.round((diff / yesterday.value.videos) * 100)}%`;
});

const todayJobs = computed(() => {
  const day = new Date().toDateString();
  return jobs.value.filter((j) => new Date(j.startedAt).toDateString() === day);
});

const todayResult = computed(() => {
  const c: Record<JobState, number> = { running: 0, done: 0, stopped: 0, error: 0 };
  for (const j of todayJobs.value) c[j.state] += 1;
  return c;
});

const finishedToday = computed(() => todayResult.value.done + todayResult.value.error);
const successRate = computed(() => {
  if (!finishedToday.value) return null;
  return Math.round((todayResult.value.done / finishedToday.value) * 100);
});

const resultSegments = computed(() => {
  const items = [
    { key: "done", label: "已完成", value: todayResult.value.done, color: "bg-mint" },
    { key: "running", label: "运行中", value: todayResult.value.running, color: "bg-primary" },
    { key: "error", label: "出错", value: todayResult.value.error, color: "bg-coral" },
    { key: "stopped", label: "已停止", value: todayResult.value.stopped, color: "bg-muted-foreground/40" },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  return { items, total };
});

// ---------- 任务记录筛选 ----------
const recordFilter = ref<"all" | JobState>("all");
const recordSearch = ref("");
const filteredJobs = computed(() => {
  const q = recordSearch.value.trim().toLowerCase();
  return jobs.value.filter((j) => {
    if (recordFilter.value !== "all" && j.state !== recordFilter.value) return false;
    if (!q) return true;
    const label = accountLabel(j.accountUid);
    return `${label} ${j.accountName ?? ""} ${j.accountUid}`.toLowerCase().includes(q);
  });
});

// ---------- 时长 ----------
const now = ref(Date.now());
let clock: number | undefined;
onMounted(() => {
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1_000);
});
onBeforeUnmount(() => window.clearInterval(clock));

function elapsedOf(job: JobVO): string {
  const start = new Date(job.startedAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now.value;
  if (!Number.isFinite(start)) return "—";
  return formatDuration(Math.max(0, (end - start) / 1000));
}
function clockOf(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

// ---------- 弹窗与操作 ----------
const addOpen = ref(false);

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

// ---------- 实时日志 ----------
const logLevel = ref<"all" | "info" | "warn" | "error">("all");
const logSearch = ref("");
/** 持久化历史日志 + SSE 实时日志，按时间合并去重 */
const mergedLogs = computed<JobEvent[]>(() => {
  const map = new Map<string, JobEvent>();
  for (const l of [...(historyLogsQuery.data.value ?? []), ...events.logs]) {
    map.set(`${l.ts}|${l.accountId ?? ""}|${l.message ?? ""}`, l);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
});
const levelCounts = computed(() => {
  const c = { info: 0, warn: 0, error: 0 };
  for (const l of mergedLogs.value) {
    if (l.level === "warn") c.warn += 1;
    else if (l.level === "error") c.error += 1;
    else c.info += 1;
  }
  return c;
});
const liveLogs = computed(() => {
  const q = logSearch.value.trim().toLowerCase();
  return mergedLogs.value
    .filter((l) => (logLevel.value === "all" || l.level === logLevel.value) && (!q || (l.message ?? "").toLowerCase().includes(q)))
    .slice(-200)
    .reverse();
});
function levelCount(key: "all" | "info" | "warn" | "error"): number {
  return key === "all" ? mergedLogs.value.length : levelCounts.value[key];
}

// ---------- 异常与标记 ----------
const recentFlags = computed(() => events.flags.slice(0, 6));
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">观测台</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">
          全站任务、日志与吞吐实时汇总
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="router.push('/schedules')">
          <AlarmClock class="size-3.5" />定时规则
        </Button>
        <Button size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="addOpen = true">
          <Plus class="size-3.5" />接入账号
        </Button>
      </div>
    </header>

    <!-- 全站指标 -->
    <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div class="panel px-4 py-3.5">
        <div class="text-[12px] text-muted-foreground">运行中任务</div>
        <div class="mt-1.5 flex items-baseline gap-2">
          <span class="mono text-[26px] font-semibold leading-none text-primary">{{ runningJobs.length }}</span>
          <span class="text-[13px] text-muted-foreground">覆盖 {{ runningAccountCount }} 个账号</span>
        </div>
        <div class="mt-2.5 flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span class="inline-flex items-center gap-1.5"><span class="size-1.5 animate-breathe rounded-full bg-primary" />实时推进</span>
          <span>全站 {{ accountsQuery.data.value?.length ?? 0 }} 个账号</span>
        </div>
      </div>

      <div class="panel px-4 py-3.5">
        <div class="flex items-start justify-between">
          <span class="text-[12px] text-muted-foreground">今日任务</span>
          <span class="mono text-[12px]" :class="(today?.errors ?? 0) > 0 ? 'text-coral' : 'text-muted-foreground'">
            出错 {{ today?.errors ?? 0 }}
          </span>
        </div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ today?.jobs ?? 0 }}</span>
          <span class="text-[13px] text-muted-foreground">个</span>
        </div>
        <div class="mt-2.5 flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span>完成 {{ todayResult.done }}</span>
          <span>运行 {{ todayResult.running }}</span>
          <span>停止 {{ todayResult.stopped }}</span>
        </div>
      </div>

      <div class="panel px-4 py-3.5">
        <div class="flex items-start justify-between">
          <span class="text-[12px] text-muted-foreground">今日完成视频</span>
          <span class="mono text-[12px] text-muted-foreground">{{ videoDelta ?? "—" }}</span>
        </div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ today?.videos ?? 0 }}</span>
          <span class="text-[13px] text-muted-foreground">段</span>
        </div>
        <Sparkline :values="videoSpark" color="var(--primary)" :height="24" class="mt-2" />
      </div>

      <div class="panel px-4 py-3.5">
        <div class="text-[12px] text-muted-foreground">近期任务成功率</div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ successRate === null ? "—" : successRate }}</span>
          <span v-if="successRate !== null" class="text-[13px] text-muted-foreground">%</span>
        </div>
        <div class="mt-2.5 flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span>完成 {{ todayResult.done }}</span>
          <span :class="todayResult.error > 0 ? 'text-coral' : ''">出错 {{ todayResult.error }}</span>
        </div>
      </div>
    </section>

    <!-- 任务与站点数据 -->
    <section class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_352px]">
      <div class="space-y-3">
        <!-- 运行中任务 -->
        <div class="panel overflow-hidden">
          <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <h2 class="text-[15px] font-semibold">运行中任务</h2>
            <span class="mono rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-primary">{{ runningJobs.length }}</span>
            <span class="text-[12px] text-muted-foreground">并行课程按每门课展示独立进度</span>
            <span class="mono ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span class="size-1.5 animate-breathe rounded-full bg-primary" />实时刷新
            </span>
          </div>
          <div v-if="runningCards.length" class="space-y-3 p-3">
            <div
              v-for="card in runningCards"
              :key="card.job.id"
              class="cursor-pointer rounded-lg border border-border bg-panel-2 p-3.5 transition-colors hover:border-primary/40"
              @click="router.push(`/accounts/${card.job.accountUid}?from=workspace`)"
            >
              <!-- 任务头部 -->
              <div class="flex flex-wrap items-start gap-3">
                <div class="flex min-w-0 flex-1 items-center gap-2.5">
                  <div class="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-card text-[14px] font-semibold text-primary">
                    {{ accountLabel(card.job.accountUid).slice(0, 1) }}
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="truncate text-[14.5px] font-medium">{{ accountLabel(card.job.accountUid) }}</span>
                      <span class="stage-chip border-primary/30 bg-primary/10 text-primary">{{ phaseLabel(card.progress, true) }}</span>
                      <span class="mono text-[12px] text-muted-foreground">{{ timeOf(card.job.startedAt) }} 启动</span>
                    </div>
                    <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">
                      {{ progressDetail(card.progress) || "正在建立会话" }}
                      · 已运行 {{ elapsedOf(card.job) }}
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <div class="text-right">
                    <div class="mono text-[18px] font-semibold leading-none">
                      {{ card.overall === null ? "—" : card.overall }}<span v-if="card.overall !== null" class="text-[12px]">%</span>
                    </div>
                    <div class="text-[12px] text-muted-foreground">整体进度</div>
                  </div>
                  <div class="text-right">
                    <div class="text-[14px]">{{ formatEta(card.progress?.etaSeconds) }}</div>
                    <div class="text-[12px] text-muted-foreground">预计剩余</div>
                  </div>
                  <div class="text-right">
                    <div class="mono text-[14px]">{{ card.progress?.courseCount ?? card.courses.length }}</div>
                    <div class="text-[12px] text-muted-foreground">剩 {{ card.progress?.coursesRemaining ?? 0 }} 门</div>
                  </div>
                  <button
                    class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-coral/40 hover:text-coral"
                    @click.stop="stopMutation.mutate(card.job.id)"
                  ><StopCircle class="size-3" />停止</button>
                </div>
              </div>

              <!-- 整体进度条 -->
              <div class="mt-3 flex items-center gap-3">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-primary transition-[width] duration-500"
                    :style="{ width: `${card.overall ?? 0}%` }"
                  />
                </div>
                <span class="mono shrink-0 text-[12px] text-muted-foreground">
                  <template v-if="card.progress?.courseTotalSeconds !== undefined">
                    总视频 {{ formatDuration(card.progress.courseTotalSeconds) }}
                    · 已学 {{ formatDuration(card.progress.courseTotalSeconds - (card.progress.courseRemainingSeconds ?? 0)) }}
                  </template>
                  <template v-else>统计中…</template>
                </span>
              </div>

              <!-- 每门课程并行进度 -->
              <div v-if="card.courses.length" class="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                <div
                  v-for="c in card.courses"
                  :key="c.courseId"
                  :class="cn(
                    'rounded-md border p-2.5 transition-colors',
                    c.completed
                      ? 'border-mint/40 bg-mint/5'
                      : c.loaded
                        ? 'border-border bg-card'
                        : 'border-dashed border-border bg-transparent opacity-60',
                  )"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="mono shrink-0 rounded px-1 text-[11.5px]"
                      :class="c.completed ? 'bg-mint/10 text-mint' : c.loaded ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
                    >{{ c.completed ? "完成" : c.loaded ? "进行中" : "等待" }}</span>
                    <span class="min-w-0 flex-1 truncate text-[13px]">{{ c.courseName }}</span>
                    <span class="mono shrink-0 text-[12px]" :class="c.completed ? 'text-mint' : 'text-muted-foreground'">{{ c.progress }}%</span>
                  </div>
                  <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full transition-[width] duration-500"
                      :class="c.completed ? 'bg-mint' : 'bg-primary'"
                      :style="{ width: `${c.progress}%` }"
                    />
                  </div>
                  <div class="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                    <span class="min-w-0 truncate">
                      <template v-if="c.completed">课程已完成</template>
                      <template v-else-if="!c.loaded">等待加载章节</template>
                      <template v-else>{{ c.currentNodeName || "准备中" }}</template>
                    </span>
                    <span class="mono shrink-0">
                      <template v-if="c.completed">—</template>
                      <template v-else-if="c.loaded">剩 {{ formatDuration(c.remainingSeconds) }}</template>
                      <template v-else>—</template>
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-[12.5px] text-muted-foreground">
                多课程进度统计中，稍后自动展开每门课程的进度。
              </div>
            </div>
          </div>
          <p v-else class="px-4 py-8 text-center text-[13px] text-muted-foreground">
            当前没有运行中的任务，全站任务记录见下方
          </p>
        </div>

        <!-- 全站任务记录 -->
        <div class="panel overflow-hidden">
          <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <h2 class="text-[15px] font-semibold">全站任务记录</h2>
            <span class="mono text-[12px] text-muted-foreground">最近 {{ jobs.length }} 条</span>
            <div class="relative ml-auto">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input v-model="recordSearch" placeholder="搜索账号" class="h-8 w-40 pl-8 text-[13px]" />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
            <button
              v-for="s in [
                { key: 'all', label: '全部' },
                { key: 'running', label: '运行中' },
                { key: 'done', label: '已完成' },
                { key: 'stopped', label: '已停止' },
                { key: 'error', label: '出错' },
              ] as const"
              :key="s.key"
              :class="cn('rounded-md border px-2.5 py-1 text-[13px] transition-colors', recordFilter === s.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
              @click="recordFilter = s.key"
            >{{ s.label }}</button>
            <span class="mono ml-auto text-[12px] text-muted-foreground">{{ filteredJobs.length }} 条</span>
          </div>

          <div v-if="jobsQuery.isLoading.value" class="space-y-2 p-4">
            <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
          </div>
          <div v-else-if="!filteredJobs.length" class="px-4 py-10 text-center text-[13px] text-muted-foreground">
            没有符合条件的任务记录
          </div>
          <div v-else class="overflow-x-auto">
            <div class="hidden min-w-[940px] grid-cols-[150px_minmax(0,1.2fr)_86px_88px_minmax(0,1.3fr)_68px_28px] gap-3 border-b border-border bg-panel-2 px-4 py-1.5 text-[12px] text-muted-foreground md:grid">
              <span>开始时间</span>
              <span>账号</span>
              <span>状态</span>
              <span>耗时</span>
              <span>产出</span>
              <span>错误</span>
              <span />
            </div>
            <div
              v-for="job in filteredJobs.slice(0, 40)"
              :key="job.id"
              class="grid min-w-[940px] cursor-pointer grid-cols-[150px_minmax(0,1.2fr)_86px_88px_minmax(0,1.3fr)_68px_28px] items-center gap-3 border-b border-border/60 px-4 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-accent/60"
              @click="router.push(`/accounts/${job.accountUid}?from=workspace`)"
            >
              <span class="mono text-[12px] text-muted-foreground">{{ timeOf(job.startedAt) }}</span>
              <span class="min-w-0 truncate">{{ accountLabel(job.accountUid) }}</span>
              <span
                :class="cn(
                  'w-fit rounded px-1.5 py-0.5 text-[12px]',
                  job.state === 'running'
                    ? 'bg-primary/10 text-primary'
                    : job.state === 'error'
                      ? 'bg-coral/10 text-coral'
                      : job.state === 'done'
                        ? 'bg-mint/10 text-mint'
                        : 'bg-muted text-muted-foreground',
                )"
              >{{ jobStateLabel(job.state) }}</span>
              <span class="mono text-[12px] text-muted-foreground">{{ elapsedOf(job) }}</span>
              <span class="mono min-w-0 truncate text-[12px] text-muted-foreground">
                <template v-if="job.summary">视频 {{ job.summary.videosCompleted }} · 作业 {{ job.summary.worksDone }} · 考试 {{ job.summary.examsDone }}</template>
                <template v-else>—</template>
              </span>
              <span class="mono text-[12px]" :class="(job.summary?.errors.length ?? 0) > 0 ? 'text-coral' : 'text-muted-foreground'">
                {{ job.summary?.errors.length ?? 0 }}
              </span>
              <ChevronRight class="size-3.5 text-muted-foreground" />
            </div>
          </div>
          <div v-if="filteredJobs.length > 40" class="border-t border-border px-4 py-2 text-center text-[12.5px] text-muted-foreground">
            仅显示最近 40 条，共 {{ filteredJobs.length }} 条
          </div>
        </div>
      </div>

      <!-- 站点遥测 -->
      <aside class="space-y-3">
        <div class="panel px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div>
              <div class="text-[13px] font-medium">14 天运行趋势</div>
              <div class="text-[12px] text-muted-foreground">全站完成视频与任务数</div>
            </div>
            <div class="text-right">
              <div class="mono text-[17px] font-semibold leading-none">{{ stats.reduce((s, d) => s + d.videos, 0) }}</div>
              <div class="text-[12px] text-muted-foreground">段视频</div>
            </div>
          </div>
          <div class="mt-2 h-[168px]">
            <DailyTrend v-if="stats.length" :data="stats" />
            <Skeleton v-else class="h-full w-full" />
          </div>
        </div>

        <div class="panel px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div class="text-[13px] font-medium">今日任务结果</div>
            <span class="mono text-[12px] text-muted-foreground">{{ resultSegments.total }} 个</span>
          </div>
          <div v-if="resultSegments.total" class="mt-2.5 flex h-2 overflow-hidden rounded-full bg-muted">
            <div
              v-for="seg in resultSegments.items"
              :key="seg.key"
              :class="seg.color"
              :style="{ width: `${(seg.value / resultSegments.total) * 100}%` }"
            />
          </div>
          <div v-if="resultSegments.total" class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div v-for="seg in resultSegments.items" :key="seg.key" class="flex items-center gap-1.5 text-[12.5px]">
              <span class="size-1.5 rounded-full" :class="seg.color" />
              <span class="text-muted-foreground">{{ seg.label }}</span>
              <span class="mono ml-auto">{{ seg.value }}</span>
            </div>
          </div>
          <p v-else class="mt-3 text-[12.5px] text-muted-foreground">今日还没有任务记录</p>
        </div>

        <div class="panel px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div class="text-[13px] font-medium">异常与标记</div>
            <span class="mono text-[12px] text-muted-foreground">{{ events.flags.length }} 条</span>
          </div>
          <div v-if="recentFlags.length" class="mt-2 space-y-1.5">
            <div v-for="(f, i) in recentFlags" :key="i" class="border-b border-border/60 pb-1.5 last:border-b-0 last:pb-0">
              <div class="flex items-baseline gap-2">
                <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ clockOf(f.ts) }}</span>
                <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ f.message || f.reason || "节点被标记" }}</span>
              </div>
              <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">{{ accountLabel(f.accountId) }}</div>
            </div>
          </div>
          <p v-else class="mt-2.5 text-[12.5px] text-muted-foreground">暂无异常或标记记录</p>
        </div>
      </aside>
    </section>

    <!-- 全站实时日志 -->
    <section class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 class="text-[15px] font-semibold">全站实时日志</h2>
        <span class="mono flex items-center gap-1.5 text-[12px] text-primary">
          <span class="size-1.5 animate-breathe rounded-full bg-primary" />SSE
        </span>
        <span class="mono text-[12px] text-muted-foreground">全站 {{ mergedLogs.length }} 条 · 含历史</span>
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <button
            v-for="l in [
              { key: 'all', label: '全部' },
              { key: 'info', label: '信息' },
              { key: 'warn', label: '警告' },
              { key: 'error', label: '错误' },
            ] as const"
            :key="l.key"
            :class="cn('rounded border px-2 py-1 text-[12.5px] transition-colors', logLevel === l.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
            @click="logLevel = l.key"
          >
            {{ l.label }}
            <span class="mono ml-1 opacity-70">{{ levelCount(l.key) }}</span>
          </button>
          <div class="relative ml-1">
            <Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="logSearch" placeholder="搜索日志" class="h-7 w-44 pl-7 text-[12.5px]" />
          </div>
        </div>
      </div>
      <div v-if="liveLogs.length" class="max-h-[360px] overflow-y-auto px-4 py-1">
        <div
          v-for="(l, i) in liveLogs"
          :key="i"
          class="flex items-baseline gap-2.5 border-b border-border/60 py-1.5 last:border-b-0"
        >
          <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ clockOf(l.ts) }}</span>
          <span
            :class="cn(
              'mono w-10 shrink-0 text-[12px] uppercase',
              l.level === 'error' ? 'text-coral' : l.level === 'warn' ? 'text-amber' : 'text-primary/80',
            )"
          >{{ l.level ?? "info" }}</span>
          <span class="shrink-0 text-[12px] text-muted-foreground">{{ accountLabel(l.accountId) }}</span>
          <span class="min-w-0 flex-1 text-[13px] text-foreground/85">{{ l.message }}</span>
        </div>
      </div>
      <p v-else class="px-4 py-10 text-center text-[13px] text-muted-foreground">
        暂无可显示的日志，发起任务后会实时汇总到这里
      </p>
    </section>

    <AddAccountDialog v-model:open="addOpen" :account="null" @saved="queryClient.invalidateQueries({ queryKey: ['accounts'] })" />
  </div>
</template>
