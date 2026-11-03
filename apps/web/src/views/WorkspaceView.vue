<script setup lang="ts">
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, ChevronRight, CircleDashed, Pause, Play, Plus, Search, StopCircle } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { JobEvent, JobState, JobVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AddAccountDialog from "@/components/account/AddAccountDialog.vue";
import DailyTrend from "@/components/charts/DailyTrend.vue";
import Sparkline from "@/components/charts/Sparkline.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
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
  () => new Set(runningCards.value.map((c) => c.job.accountUid)).size,
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

/** 当前节点进度（0-100）；没有进度事件时返回 null */
function nodePercent(progress?: JobEvent | null): number | null {
  return typeof progress?.progress === "number"
    ? Math.min(100, Math.max(0, Math.round(progress.progress)))
    : null;
}

/** 运行中任务卡片：账号 + 整体进度 + 每门课程的独立进度 */
const realRunningCards = computed(() =>
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

/** 运行中任务数 */
const runningCards = realRunningCards;
const runningCount = computed(() => runningCards.value.length);

/** 已发起停止、等待运行器收尾的任务 */
const stopping = ref<Record<string, boolean>>({});
/** 批量操作选中的任务 */
const selectedJobIds = ref<Record<string, boolean>>({});
const selectedCards = computed(() => runningCards.value.filter((c) => selectedJobIds.value[c.job.id]));
const selectedCount = computed(() => selectedCards.value.length);
const allSelected = computed(
  () => runningCards.value.length > 0 && runningCards.value.every((c) => selectedJobIds.value[c.job.id]),
);
function toggleSelect(jobId: string) {
  selectedJobIds.value = { ...selectedJobIds.value, [jobId]: !selectedJobIds.value[jobId] };
}
function toggleSelectAll() {
  if (allSelected.value) {
    selectedJobIds.value = {};
    return;
  }
  const next: Record<string, boolean> = {};
  for (const card of runningCards.value) next[card.job.id] = true;
  selectedJobIds.value = next;
}

/** 暂停状态：接口成功后先本地生效，轮询拿到后端 paused 后保持一致 */
const pausedOverride = ref<Record<string, boolean>>({});
function isJobPaused(job: JobVO): boolean {
  return pausedOverride.value[job.id] ?? job.paused ?? false;
}
async function togglePause(job: JobVO) {
  const next = !isJobPaused(job);
  if (next) {
    const ok = await confirmAction({
      title: `暂停「${accountLabel(job.accountUid)}」的任务？`,
      description: "暂停后不再提交新进度，任务会保留在当前节点，继续后可接着刷。",
      confirmText: "暂停任务",
    });
    if (!ok) return;
  }
  try {
    if (next) await api.pauseJob(job.id);
    else await api.resumeJob(job.id);
    pausedOverride.value = { ...pausedOverride.value, [job.id]: next };
    toast.info(next ? "任务已暂停" : "任务已继续");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  } catch (err) {
    toastError(err, next ? "暂停任务失败" : "继续任务失败");
  }
}

async function pauseSelected() {
  const targets = selectedCards.value.filter((c) => !isJobPaused(c.job));
  if (!targets.length) {
    toast.info("所选任务均处于暂停状态或已结束");
    return;
  }
  const ok = await confirmAction({
    title: `暂停所选 ${targets.length} 个任务？`,
    description: "暂停后不再提交新进度，任务保留在当前节点，可在批量操作条里继续。",
    confirmText: "暂停所选",
  });
  if (!ok) return;
  const results = await Promise.allSettled(
    targets.map(async (c) => {
      await api.pauseJob(c.job.id);
      pausedOverride.value = { ...pausedOverride.value, [c.job.id]: true };
    }),
  );
  const done = results.filter((r) => r.status === "fulfilled").length;
  toast.info(done ? `已暂停 ${done} 个任务` : "所选任务均处于暂停状态或已结束");
  void queryClient.invalidateQueries({ queryKey: ["jobs"] });
}

async function resumeSelected() {
  const targets = selectedCards.value.filter((c) => isJobPaused(c.job));
  const results = await Promise.allSettled(
    targets.map(async (c) => {
      await api.resumeJob(c.job.id);
      pausedOverride.value = { ...pausedOverride.value, [c.job.id]: false };
    }),
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  toast.info(ok ? `已继续 ${ok} 个任务` : "所选任务均未处于暂停状态");
  void queryClient.invalidateQueries({ queryKey: ["jobs"] });
}

async function stopSelected() {
  const count = selectedCards.value.length;
  const ok = await confirmAction({
    title: `停止所选 ${count} 个任务？`,
    description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
    confirmText: "全部停止",
    tone: "danger",
  });
  if (!ok) return;
  for (const card of selectedCards.value) void stopJob(card.job, true);
  toast.info(`已请求停止 ${count} 个任务`);
  selectedJobIds.value = {};
}

watch(
  () => jobsQuery.data.value,
  (list) => {
    const runningIds = new Set((list ?? []).filter((j) => j.state === "running").map((j) => j.id));
    let nextStopping: Record<string, boolean> | null = null;
    for (const id of Object.keys(stopping.value)) {
      if (!runningIds.has(id)) {
        nextStopping ??= { ...stopping.value };
        delete nextStopping[id];
      }
    }
    if (nextStopping) stopping.value = nextStopping;

    let nextSelected: Record<string, boolean> | null = null;
    for (const id of Object.keys(selectedJobIds.value)) {
      if (!runningIds.has(id)) {
        nextSelected ??= { ...selectedJobIds.value };
        delete nextSelected[id];
      }
    }
    if (nextSelected) selectedJobIds.value = nextSelected;
  },
);

async function stopJob(job: JobVO, silent = false) {
  if (stopping.value[job.id]) return;
  if (!silent) {
    const ok = await confirmAction({
      title: `停止「${accountLabel(job.accountUid)}」的任务？`,
      description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
      confirmText: "停止任务",
      tone: "danger",
    });
    if (!ok) return;
  }
  stopping.value = { ...stopping.value, [job.id]: true };
  // 兜底：长时间未收尾则释放按钮，允许再次请求停止
  window.setTimeout(() => {
    if (!stopping.value[job.id]) return;
    const next = { ...stopping.value };
    delete next[job.id];
    stopping.value = next;
    if (!silent) toast.warning("停止请求已发出但任务仍未结束，可稍后重试");
  }, 20_000);
  try {
    const r = await api.stopJob(job.id);
    if (!silent) {
      if (r.stopped) toast.info("已请求停止，任务正在收尾");
      else toast.warning(r.reason ?? "任务已结束");
    }
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  } catch (err) {
    if (!silent) toastError(err, "停止任务失败");
    const next = { ...stopping.value };
    delete next[job.id];
    stopping.value = next;
  }
}

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

// ---------- 实时日志 ----------
const logLevel = ref<"all" | "info" | "warn" | "error">("all");
const logSearch = ref("");
/** 只保留运行中任务的日志，避免已结束任务的上下文污染观测台 */
const runningJobIds = computed(() => new Set(runningJobs.value.map((j) => j.id)));
/** 持久化历史日志 + SSE 实时日志，按时间合并去重，仅保留运行中任务 */
const mergedLogs = computed<JobEvent[]>(() => {
  const map = new Map<string, JobEvent>();
  for (const l of [...(historyLogsQuery.data.value ?? []), ...events.logs]) {
    if (!l.jobId || !runningJobIds.value.has(l.jobId)) continue;
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
/** 右侧实时事件流：只保留运行中任务的最近 14 条实时日志 */
const recentEvents = computed(() =>
  events.logs.filter((l) => l.jobId && runningJobIds.value.has(l.jobId)).slice(-14).reverse(),
);
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
          <span class="mono text-[26px] font-semibold leading-none text-primary">{{ runningCount }}</span>
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
      <div class="flex min-w-0 flex-col gap-3">
      <!-- 运行中任务 -->
        <div :class="cn('panel overflow-hidden', !runningCards.length && 'xl:flex xl:flex-1 xl:flex-col')">
          <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <span @click.stop>
              <Checkbox :model-value="allSelected" @update:model-value="toggleSelectAll" />
            </span>
            <h2 class="text-[15px] font-semibold">运行中任务</h2>
            <span class="mono rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-primary">{{ runningCount }}</span>
            <span class="text-[12px] text-muted-foreground">进度每 5 秒采样 · 多任务时列表内滚动</span>
            <span class="mono ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span class="size-1.5 animate-breathe rounded-full bg-primary" />实时刷新
            </span>
          </div>

          <!-- 批量操作条 -->
          <div v-if="selectedCount" class="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2">
            <span class="mono text-[12.5px] text-primary">已选 {{ selectedCount }} 个任务</span>
            <span class="text-[12px] text-muted-foreground">暂停会保留任务，继续后从当前节点接着刷</span>
            <div class="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                class="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-amber/40 hover:text-amber"
                @click="pauseSelected"
              ><Pause class="size-3" />暂停所选</button>
              <button
                class="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                @click="resumeSelected"
              ><Play class="size-3" />继续所选</button>
              <button
                class="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-coral/40 hover:text-coral"
                @click="stopSelected"
              ><StopCircle class="size-3" />停止所选</button>
              <button class="rounded px-2 py-1 text-[12.5px] text-muted-foreground hover:text-foreground" @click="selectedJobIds = {}">取消</button>
            </div>
          </div>
          <div
            v-if="runningCards.length"
            :class="cn(
              'p-3',
              runningCards.length > 2 && 'max-h-[min(68vh,640px)] overflow-y-auto overscroll-contain',
            )"
          >
            <div class="columns-1 gap-3 lg:columns-2">
              <div
                v-for="card in runningCards"
                :key="card.job.id"
                :class="cn(
                  'mb-3 break-inside-avoid cursor-pointer rounded-lg border p-3 transition-colors last:mb-0',
                  selectedJobIds[card.job.id] ? 'border-primary/50 bg-primary/5' : 'border-border bg-panel-2 hover:border-primary/40',
                )"
                @click="router.push(`/accounts/${card.job.accountUid}?from=workspace`)"
              >
                <!-- 头部：身份 + 阶段 -->
                <div class="flex items-start gap-2.5">
                  <span class="mt-0.5" @click.stop>
                    <Checkbox
                      :model-value="!!selectedJobIds[card.job.id]"
                      @update:model-value="toggleSelect(card.job.id)"
                    />
                  </span>
                  <div class="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card text-[13px] font-semibold text-primary">
                    {{ accountLabel(card.job.accountUid).slice(0, 1) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="min-w-0 flex-1 truncate text-[14.5px] font-medium">{{ accountLabel(card.job.accountUid) }}</span>
                      <span v-if="isJobPaused(card.job)" class="shrink-0 rounded bg-amber/10 px-1 text-[11px] text-amber">已暂停</span>
                      <span class="stage-chip shrink-0 border-primary/30 bg-primary/10 text-primary">{{ phaseLabel(card.progress, true) }}</span>
                    </div>
                    <div class="mono mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {{ progressDetail(card.progress) || "正在建立会话" }}
                    </div>
                  </div>
                </div>

                <!-- 指标带 -->
                <div class="mt-2.5 grid grid-cols-3 gap-2">
                  <div class="rounded-md border border-border bg-card px-2 py-1.5">
                    <div class="mono text-[15px] font-semibold leading-none">{{ card.overall === null ? "—" : `${card.overall}%` }}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">整体进度</div>
                  </div>
                  <div class="rounded-md border border-border bg-card px-2 py-1.5">
                    <div class="truncate text-[13px] leading-none">{{ formatEta(card.progress?.etaSeconds) }}</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">预计剩余</div>
                  </div>
                  <div class="rounded-md border border-border bg-card px-2 py-1.5">
                    <div class="mono truncate text-[13px] leading-none">{{ card.progress?.courseCount ?? card.courses.length }} 门</div>
                    <div class="mt-1 text-[11px] text-muted-foreground">剩 {{ card.progress?.coursesRemaining ?? 0 }} 门</div>
                  </div>
                </div>

                <!-- 整体进度条 -->
                <div
                  class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                  :title="card.progress?.courseTotalSeconds !== undefined
                    ? `总视频 ${formatDuration(card.progress.courseTotalSeconds)} · 已学 ${formatDuration(card.progress.courseTotalSeconds - (card.progress.courseRemainingSeconds ?? 0))}`
                    : ''"
                >
                  <div
                    class="h-full rounded-full bg-primary transition-[width] duration-500"
                    :style="{ width: `${card.overall ?? 0}%` }"
                  />
                </div>

                <!-- 当前节点进度 -->
                <div class="mt-2 flex items-center gap-2">
                  <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">当前节点</span>
                  <div class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary/80 transition-[width] duration-500"
                      :style="{ width: `${nodePercent(card.progress) ?? 0}%` }"
                    />
                  </div>
                  <span class="mono shrink-0 text-[11.5px]" :class="nodePercent(card.progress) === null ? 'text-muted-foreground' : 'text-foreground/80'">
                    {{ nodePercent(card.progress) === null ? "—" : `${nodePercent(card.progress)}%` }}
                  </span>
                </div>

                <!-- 课程列表 -->
                <div v-if="card.courses.length" class="mt-2 overflow-hidden rounded-md border border-border bg-card">
                  <div class="max-h-[132px] divide-y divide-border/60 overflow-y-auto">
                    <div
                      v-for="c in card.courses"
                      :key="c.courseId"
                      class="flex items-center gap-2 px-2 py-1.5"
                      :title="c.completed
                        ? `${c.courseName} · 已完成`
                        : c.loaded
                          ? `${c.courseName} · ${c.currentNodeName ?? '进行中'} · 剩 ${formatDuration(c.remainingSeconds)}`
                          : `${c.courseName} · 等待加载章节`"
                    >
                      <span
                        class="size-1.5 shrink-0 rounded-full"
                        :class="c.completed ? 'bg-mint' : c.loaded ? 'bg-primary' : 'bg-muted-foreground/40'"
                      />
                      <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ c.courseName }}</span>
                      <div class="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                        <div
                          class="h-full rounded-full transition-[width] duration-500"
                          :class="c.completed ? 'bg-mint' : 'bg-primary'"
                          :style="{ width: `${c.progress}%` }"
                        />
                      </div>
                      <span class="mono w-9 shrink-0 text-right text-[11.5px]" :class="c.completed ? 'text-mint' : 'text-muted-foreground'">{{ c.progress }}%</span>
                    </div>
                  </div>
                </div>

                <!-- 底栏：运行时长 + 操作 -->
                <div class="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span class="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <span
                      class="size-1 rounded-full"
                      :class="isJobPaused(card.job) ? 'bg-amber' : 'animate-breathe bg-primary'"
                    />
                    {{ isJobPaused(card.job) ? "已暂停" : "已运行" }} {{ elapsedOf(card.job) }}
                  </span>
                  <div class="flex items-center gap-1.5">
                    <button
                      class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-amber/40 hover:text-amber"
                      @click.stop="togglePause(card.job)"
                    >
                      <Play v-if="isJobPaused(card.job)" class="size-3" />
                      <Pause v-else class="size-3" />
                      {{ isJobPaused(card.job) ? "继续" : "暂停" }}
                    </button>
                    <button
                      :disabled="stopping[card.job.id]"
                      :class="cn(
                        'inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[12px] transition-colors',
                        stopping[card.job.id]
                          ? 'cursor-not-allowed border-border text-muted-foreground opacity-60'
                          : 'border-border text-muted-foreground hover:border-coral/40 hover:text-coral',
                      )"
                      @click.stop="stopJob(card.job)"
                    ><StopCircle class="size-3" />{{ stopping[card.job.id] ? "停止中…" : "停止" }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            v-else
            class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center xl:min-h-[220px] xl:flex-1"
          >
            <span class="grid size-10 place-items-center rounded-full border border-border bg-panel-2 text-muted-foreground">
              <CircleDashed class="size-5" />
            </span>
            <p class="text-[14px] text-muted-foreground">当前没有运行中的任务</p>
            <p class="text-[12.5px] text-muted-foreground/80">发起任务后，这里会按账号展示课程与实时进度；全站任务记录见下方</p>
          </div>
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
          <div v-else class="max-h-[min(45vh,440px)] overflow-y-auto overflow-x-auto overscroll-contain">
            <div class="sticky top-0 z-10 hidden min-w-[940px] grid-cols-[150px_minmax(0,1.2fr)_86px_88px_minmax(0,1.3fr)_68px_28px] gap-3 border-b border-border bg-panel-2 px-4 py-1.5 text-[12px] text-muted-foreground md:grid">
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
      <aside class="flex flex-col gap-3 xl:h-full">
        <div class="panel flex h-[240px] flex-col px-3.5 py-3">
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
          <div class="mt-2 min-h-0 flex-1">
            <DailyTrend v-if="stats.length" :data="stats" />
            <Skeleton v-else class="h-full w-full" />
          </div>
        </div>

        <!-- 实时事件流：填满右栏剩余高度 -->
        <div class="panel flex h-[240px] flex-col overflow-hidden xl:h-auto xl:min-h-[160px] xl:flex-1">
          <div class="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <span class="text-[13px] font-medium">运行中日志</span>
            <span class="mono text-[12px] text-muted-foreground">{{ mergedLogs.length }}</span>
            <span class="mono ml-auto flex items-center gap-1 text-[11.5px] text-primary">
              <span class="size-1 animate-breathe rounded-full bg-primary" />LIVE
            </span>
          </div>
          <div v-if="recentEvents.length" class="min-h-0 flex-1 overflow-y-auto px-3.5 py-1">
            <div
              v-for="(e, i) in recentEvents"
              :key="i"
              class="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-b-0"
            >
              <span
                class="mt-1.5 size-1.5 shrink-0 rounded-full"
                :class="e.level === 'error' ? 'bg-coral' : e.level === 'warn' ? 'bg-amber' : 'bg-primary'"
              />
              <span class="mono shrink-0 text-[11.5px] text-muted-foreground">{{ clockOf(e.ts) }}</span>
              <span class="min-w-0 flex-1 truncate text-[12px] text-foreground/85" :title="e.message">{{ e.message }}</span>
            </div>
          </div>
          <p v-else class="px-3.5 py-8 text-center text-[12px] text-muted-foreground">当前运行任务暂无日志</p>
        </div>

        <div class="panel flex h-[240px] flex-col overflow-hidden">
          <div class="px-3.5 py-2.5">
            <div class="flex items-baseline justify-between">
              <span class="text-[13px] font-medium">今日任务结果</span>
              <span class="mono text-[12px] text-muted-foreground">{{ resultSegments.total }} 个</span>
            </div>
            <div v-if="resultSegments.total" class="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
              <div
                v-for="seg in resultSegments.items"
                :key="seg.key"
                :class="seg.color"
                :style="{ width: `${(seg.value / resultSegments.total) * 100}%` }"
              />
            </div>
            <div v-if="resultSegments.total" class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <div v-for="seg in resultSegments.items" :key="seg.key" class="flex items-center gap-1.5 text-[12px]">
                <span class="size-1.5 rounded-full" :class="seg.color" />
                <span class="text-muted-foreground">{{ seg.label }}</span>
                <span class="mono ml-auto">{{ seg.value }}</span>
              </div>
            </div>
            <p v-else class="mt-2 text-[12px] text-muted-foreground">今日还没有任务记录</p>
          </div>

          <div class="flex min-h-0 flex-1 flex-col border-t border-border px-3.5 py-2">
            <div class="flex items-baseline justify-between">
              <span class="text-[12px] font-medium">异常与标记</span>
              <span class="mono text-[11.5px] text-muted-foreground">{{ events.flags.length }} 条</span>
            </div>
            <div v-if="recentFlags.length" class="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              <div v-for="(f, i) in recentFlags" :key="i" class="border-b border-border/60 pb-1 last:border-b-0 last:pb-0">
                <div class="flex items-baseline gap-2">
                  <span class="mono shrink-0 text-[11.5px] text-muted-foreground">{{ clockOf(f.ts) }}</span>
                  <span class="min-w-0 flex-1 truncate text-[12px]">{{ f.message || f.reason || "节点被标记" }}</span>
                </div>
                <div class="mono mt-0.5 truncate text-[11.5px] text-muted-foreground">{{ accountLabel(f.accountId) }}</div>
              </div>
            </div>
            <p v-else class="mt-1 text-[12px] text-muted-foreground">暂无异常或标记记录</p>
          </div>
        </div>
      </aside>
    </section>

    <!-- 运行中任务日志 -->
    <section class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 class="text-[15px] font-semibold">运行中任务日志</h2>
        <span class="mono flex items-center gap-1.5 text-[12px] text-primary">
          <span class="size-1.5 animate-breathe rounded-full bg-primary" />SSE
        </span>
        <span class="mono text-[12px] text-muted-foreground">当前 {{ mergedLogs.length }} 条 · 任务结束后自动清空</span>
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
        当前没有运行中的任务，启动任务后会实时显示其日志
      </p>
    </section>

    <AddAccountDialog v-model:open="addOpen" :account="null" @saved="queryClient.invalidateQueries({ queryKey: ['accounts'] })" />
  </div>
</template>
