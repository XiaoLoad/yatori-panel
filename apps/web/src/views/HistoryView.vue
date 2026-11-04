<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, History, Search, Square, Video } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { JobVO } from "@yatori/shared";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import DailyTrend from "@/components/charts/DailyTrend.vue";
import { formatDuration } from "@/lib/account";
import { relativeTime } from "@/lib/utils";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
import { isPending, runPending } from "@/lib/pending";
import { cn } from "@/lib/utils";

const router = useRouter();
const queryClient = useQueryClient();
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts() });
// 汇总卡片与侧栏仍使用最近一批记录，避免每页数据影响统计口径
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 80 }, { silent: true }),
  refetchInterval: 5_000,
});
const statsQuery = useQuery({
  queryKey: ["stats", 7],
  queryFn: () => api.statsDaily(7, { silent: true }),
  refetchInterval: 60_000,
});

const accountFilter = ref("all");
const stateFilter = ref<"all" | "running" | "done" | "stopped" | "error">("all");
const search = ref("");
const debouncedSearch = ref("");
const page = ref(1);
const pageSize = ref(20);
const expanded = ref<string | null>(null);

let searchTimer: number | undefined;
watch(search, (value) => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    debouncedSearch.value = value.trim();
  }, 300);
});

const recordsQuery = useQuery({
  queryKey: computed(() => [
    "jobs-page",
    {
      accountUid: accountFilter.value,
      state: stateFilter.value,
      search: debouncedSearch.value,
      page: page.value,
      pageSize: pageSize.value,
    },
  ]),
  queryFn: () =>
    api.jobsPage(
      {
        accountUid: accountFilter.value === "all" ? undefined : accountFilter.value,
        state: stateFilter.value === "all" ? undefined : stateFilter.value,
        search: debouncedSearch.value || undefined,
        page: page.value,
        pageSize: pageSize.value,
      },
      { silent: true },
    ),
  refetchInterval: 10_000,
});

const accounts = computed(() => accountsQuery.data.value ?? []);
const accountOptions = computed(() => [
  { value: "all", label: "全部账号" },
  ...accounts.value.map((a) => ({ value: a.uid, label: a.remark ? `${a.remark} · ${a.username}` : a.username })),
]);

function label(uid: string): string {
  const a = accounts.value.find((x) => x.uid === uid);
  if (!a) return uid.slice(0, 8);
  return a.remark ? `${a.remark} · ${a.username}` : a.username;
}

const pageJobs = computed(() => recordsQuery.data.value?.items ?? []);
const total = computed(() => recordsQuery.data.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
watch([accountFilter, stateFilter, debouncedSearch], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});
watch(pageSize, () => {
  page.value = 1;
});

const allJobs = computed(() => jobsQuery.data.value ?? []);
const stateCounts = computed(() => {
  const c = { running: 0, done: 0, stopped: 0, error: 0 };
  for (const j of allJobs.value) c[j.state] += 1;
  return c;
});
const totalJobs = computed(() => allJobs.value.length);
const finishedJobs = computed(() => stateCounts.value.done + stateCounts.value.error);
const successRate = computed(() =>
  finishedJobs.value ? Math.round((stateCounts.value.done / finishedJobs.value) * 100) : null,
);

const totals = computed(() => {
  const t = { videos: 0, skipped: 0, works: 0, exams: 0, flags: 0, errors: 0 };
  for (const j of allJobs.value) {
    if (!j.summary) continue;
    t.videos += j.summary.videosCompleted;
    t.skipped += j.summary.videosSkipped;
    t.works += j.summary.worksDone;
    t.exams += j.summary.examsDone;
    t.flags += j.summary.flagsFound;
    t.errors += j.summary.errors.length;
  }
  return t;
});

// ---------- 按天分组 ----------
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const week = WEEK[new Date(`${key}T00:00:00`).getDay()];
  if (key === today) return `今天 · ${key} ${week}`;
  if (key === yesterday) return `昨天 · ${key} ${week}`;
  return `${key} ${week}`;
}
const groups = computed(() => {
  const map = new Map<string, JobVO[]>();
  for (const j of pageJobs.value) {
    const key = dayKey(j.startedAt);
    map.set(key, [...(map.get(key) ?? []), j]);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: dayLabel(key),
    items,
    done: items.filter((j) => j.state === "done").length,
    error: items.filter((j) => j.state === "error").length,
  }));
});

const stats = computed(() => statsQuery.data.value ?? []);
const recentErrors = computed(() => {
  const out: { key: string; job: JobVO; message: string }[] = [];
  for (const j of allJobs.value) {
    (j.summary?.errors ?? []).forEach((message, i) => {
      out.push({ key: `${j.id}-${i}`, job: j, message });
    });
  }
  return out.slice(0, 6);
});

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs-page"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

async function askStop(job: JobVO) {
  if (isPending(`stop:${job.id}`)) return;
  const ok = await confirmAction({
    title: `停止「${job.accountName || job.accountUid.slice(0, 6)}」的任务？`,
    description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
    confirmText: "停止任务",
    tone: "danger",
  });
  if (ok) runPending(`stop:${job.id}`, () => stopMutation.mutateAsync(job.id));
}

function outputOf(job: JobVO): { videos: number; works: number; exams: number; flags: number; errors: number } | null {
  if (!job.summary) return null;
  return {
    videos: job.summary.videosCompleted,
    works: job.summary.worksDone,
    exams: job.summary.examsDone,
    flags: job.summary.flagsFound,
    errors: job.summary.errors.length,
  };
}
function durationOf(job: JobVO): string {
  if (!job.finishedAt) return job.state === "running" ? "进行中" : "—";
  const sec = (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000;
  return formatDuration(sec);
}
function modeText(mode: number): string {
  return { 1: "普通", 2: "暴力", 3: "去红" }[mode] ?? String(mode);
}
function sourceText(source: string): string {
  return { off: "不答题", ai: "AI", bank: "题库" }[source] ?? source;
}
function submitText(mode: string): string {
  return { off: "不交卷", smart: "智能", direct: "直交" }[mode] ?? mode;
}
function stateLabel(state: JobVO["state"]): string {
  return { running: "运行中", done: "已完成", stopped: "已停止", error: "出错" }[state];
}
function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">台账</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">全站任务记录 · 按天归档，可展开查看配置、产出与错误明细</p>
      </div>
    </header>

    <!-- 汇总指标 -->
    <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div class="panel px-4 py-3.5">
        <div class="text-[12px] text-muted-foreground">任务总数</div>
        <div class="mt-1.5 flex items-baseline gap-2">
          <span class="mono text-[26px] font-semibold leading-none">{{ totalJobs }}</span>
          <span class="text-[13px] text-muted-foreground">条记录</span>
        </div>
        <div class="mt-2.5 flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-mint" />完成 {{ stateCounts.done }}</span>
          <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-coral" />出错 {{ stateCounts.error }}</span>
        </div>
      </div>
      <div class="panel px-4 py-3.5">
        <div class="text-[12px] text-muted-foreground">任务成功率</div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ successRate === null ? "—" : successRate }}</span>
          <span v-if="successRate !== null" class="text-[13px] text-muted-foreground">%</span>
        </div>
        <div class="mt-2.5 text-[12.5px] text-muted-foreground">完成 {{ stateCounts.done }} · 出错 {{ stateCounts.error }}</div>
      </div>
      <div class="panel px-4 py-3.5">
        <div class="flex items-start justify-between">
          <span class="text-[12px] text-muted-foreground">完成视频</span>
          <Video class="size-4 text-muted-foreground" />
        </div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ totals.videos }}</span>
          <span class="text-[13px] text-muted-foreground">段</span>
        </div>
        <div class="mt-2.5 text-[12.5px] text-muted-foreground">跳过 {{ totals.skipped }} · 标红 {{ totals.flags }}</div>
      </div>
      <div class="panel px-4 py-3.5">
        <div class="text-[12px] text-muted-foreground">作业 / 考试</div>
        <div class="mt-1.5 flex items-baseline gap-1.5">
          <span class="mono text-[26px] font-semibold leading-none">{{ totals.works }}</span>
          <span class="text-[13px] text-muted-foreground">/ {{ totals.exams }}</span>
        </div>
        <div class="mt-2.5 text-[12.5px]" :class="totals.errors > 0 ? 'text-coral' : 'text-muted-foreground'">
          记录错误 {{ totals.errors }} 条
        </div>
      </div>
    </section>

    <section class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <!-- 记录 -->
      <div class="panel min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 class="text-[16px] font-semibold">任务记录</h2>
            <span class="mono text-[12px] text-muted-foreground">{{ total }} 条</span>
          </div>
          <div class="relative ml-auto">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索账号 / 任务 ID" class="h-8 w-48 pl-8 text-[13px]" />
          </div>
          <Select v-model="accountFilter" :options="accountOptions" class="h-8 w-48 text-[13px]" />
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
            :class="cn('rounded-md border px-2.5 py-1 text-[13px] transition-colors', stateFilter === s.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
            @click="stateFilter = s.key"
          >{{ s.label }}</button>
          <span class="mono ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-mint" />{{ stateCounts.done }}</span>
            <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-coral" />{{ stateCounts.error }}</span>
            <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary" />{{ stateCounts.running }}</span>
          </span>
        </div>

        <div v-if="recordsQuery.isLoading.value" class="h-[520px] space-y-2 overflow-hidden p-4">
          <Skeleton v-for="i in 6" :key="i" class="h-10 w-full" />
        </div>
        <div v-else-if="!pageJobs.length" class="flex h-[520px] flex-col items-center justify-center px-6 text-center">
          <div class="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-panel-2 text-muted-foreground">
            <History class="size-5" />
          </div>
          <h2 class="mt-4 text-[16px] font-semibold">没有符合条件的记录</h2>
          <p class="mt-1 text-[14px] text-muted-foreground">调整筛选条件，或到观测台发起新任务</p>
        </div>

        <div v-else class="h-[520px] overflow-y-auto overflow-x-auto overscroll-contain">
          <div class="sticky top-0 z-10 hidden min-w-[1000px] grid-cols-[84px_minmax(0,1.2fr)_112px_72px_minmax(0,1.05fr)_minmax(0,1.15fr)_28px_72px] gap-3 border-b border-border bg-panel-2 px-4 py-1.5 text-[12px] text-muted-foreground md:grid">
            <span>状态</span>
            <span>账号</span>
            <span>开始时间</span>
            <span>耗时</span>
            <span>配置</span>
            <span>产出</span>
            <span />
            <span class="text-right">操作</span>
          </div>

          <template v-for="group in groups" :key="group.key">
            <!-- 日期分隔 -->
            <div class="flex min-w-[1000px] items-center gap-2 border-b border-border bg-panel-2/70 px-4 py-1.5">
              <span class="text-[13px] font-medium">{{ group.label }}</span>
              <span class="mono text-[12px] text-muted-foreground">{{ group.items.length }} 条</span>
              <span class="h-px flex-1 bg-border" />
              <span class="mono text-[12px] text-mint">完成 {{ group.done }}</span>
              <span v-if="group.error" class="mono text-[12px] text-coral">出错 {{ group.error }}</span>
            </div>

            <template v-for="job in group.items" :key="job.id">
              <div
                class="grid min-w-[1000px] cursor-pointer grid-cols-[84px_minmax(0,1.2fr)_112px_72px_minmax(0,1.05fr)_minmax(0,1.15fr)_28px_72px] items-center gap-3 border-b border-border/60 px-4 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-accent/50"
                @click="expanded = expanded === job.id ? null : job.id"
              >
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
                >{{ stateLabel(job.state) }}</span>
                <span class="min-w-0 truncate">{{ label(job.accountUid) }}</span>
                <span class="mono text-[12px] text-muted-foreground">{{ relativeTime(job.startedAt) }}</span>
                <span class="mono text-[12px] text-muted-foreground">{{ durationOf(job) }}</span>
                <span class="mono min-w-0 truncate text-[12px] text-muted-foreground">
                  {{ modeText(job.options.videoMode) }} · {{ sourceText(job.options.answerSource) }} · {{ submitText(job.options.submitMode) }}
                </span>
                <span class="flex flex-wrap items-center gap-1">
                  <template v-if="outputOf(job)">
                    <span v-if="outputOf(job)!.videos" class="mono rounded bg-muted px-1.5 text-[12px]">视频 {{ outputOf(job)!.videos }}</span>
                    <span v-if="outputOf(job)!.works" class="mono rounded bg-muted px-1.5 text-[12px]">作业 {{ outputOf(job)!.works }}</span>
                    <span v-if="outputOf(job)!.exams" class="mono rounded bg-muted px-1.5 text-[12px]">考试 {{ outputOf(job)!.exams }}</span>
                    <span v-if="outputOf(job)!.flags" class="mono rounded bg-amber/10 px-1.5 text-[12px] text-amber">标红 {{ outputOf(job)!.flags }}</span>
                    <span v-if="outputOf(job)!.errors" class="mono text-[12px] text-coral">错误 {{ outputOf(job)!.errors }}</span>
                    <span
                      v-if="!outputOf(job)!.videos && !outputOf(job)!.works && !outputOf(job)!.exams && !outputOf(job)!.flags && !outputOf(job)!.errors"
                      class="text-muted-foreground"
                    >—</span>
                  </template>
                  <span v-else class="text-muted-foreground">—</span>
                </span>
                <span class="text-muted-foreground">
                  <ChevronDown v-if="expanded !== job.id" class="size-4" />
                  <ChevronUp v-else class="size-4" />
                </span>
                <span class="flex justify-end" @click.stop>
                  <Button
                    v-if="job.state === 'running'"
                    variant="outline"
                    size="sm"
                    class="h-6 gap-1 px-2 text-[12px]"
                    :disabled="isPending(`stop:${job.id}`)"
                    @click="askStop(job)"
                  ><Square class="size-3" />停止</Button>
                  <span v-else class="text-[12px] text-muted-foreground">—</span>
                </span>
              </div>

              <!-- 展开明细 -->
              <div v-if="expanded === job.id" class="min-w-[1000px] border-b border-border bg-panel-2/50 px-4 py-3" @click.stop>
                <div class="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div>
                    <div class="text-[12px] text-muted-foreground">运行配置</div>
                    <div class="mono mt-1 space-y-0.5 text-[12.5px]">
                      <div>刷课模式 {{ modeText(job.options.videoMode) }} · 答题 {{ sourceText(job.options.answerSource) }} · 交卷 {{ submitText(job.options.submitMode) }}</div>
                      <div>课程范围 {{ job.options.courseIds.length ? `${job.options.courseIds.length} 门勾选` : "全部课程" }} · 课程并发 {{ job.options.perCourseConcurrency }}</div>
                      <div class="text-muted-foreground">任务 ID {{ job.id.slice(0, 8) }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="text-[12px] text-muted-foreground">时间</div>
                    <div class="mono mt-1 space-y-0.5 text-[12.5px]">
                      <div>开始 {{ absoluteTime(job.startedAt) }}</div>
                      <div>结束 {{ job.finishedAt ? absoluteTime(job.finishedAt) : "—" }}</div>
                      <div>耗时 {{ durationOf(job) }}</div>
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-[12px] text-muted-foreground">错误明细</span>
                      <span v-if="job.summary?.errors.length" class="mono rounded bg-coral/10 px-1.5 text-[12px] text-coral">{{ job.summary.errors.length }}</span>
                    </div>
                    <div v-if="job.summary?.errors.length" class="mt-1 max-h-32 space-y-1 overflow-y-auto">
                      <div v-for="(err, i) in job.summary.errors" :key="i" class="flex items-start gap-1.5 text-[12.5px] text-coral">
                        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
                        <span>{{ err }}</span>
                      </div>
                    </div>
                    <div v-else class="mt-1 text-[12.5px] text-muted-foreground">无错误</div>
                    <div v-if="job.summary?.scores.length" class="mt-2">
                      <div class="text-[12px] text-muted-foreground">得分记录</div>
                      <div v-for="(s, i) in job.summary.scores" :key="i" class="text-[12.5px] text-muted-foreground">{{ s }}</div>
                    </div>
                  </div>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-3">
                  <button class="text-[12.5px] text-primary hover:underline" @click="router.push(`/accounts/${job.accountUid}?from=history`)">
                    查看账号详情与课程进度 →
                  </button>
                  <span v-if="job.summary" class="mono text-[12px] text-muted-foreground">
                    课程 {{ job.summary.courses }} 门 · 跳过 {{ job.summary.videosSkipped }} · 错误 {{ job.summary.errors.length }}
                  </span>
                </div>
              </div>
            </template>
          </template>
        </div>

        <!-- 分页 -->
        <div
          v-if="!recordsQuery.isLoading.value && total > 0"
          class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5"
        >
          <span class="mono text-[12px] text-muted-foreground">共 {{ total }} 条 · 第 {{ page }}/{{ pageCount }} 页</span>
          <div class="ml-auto flex items-center gap-1.5">
            <Select
              :model-value="String(pageSize)"
              :options="[
                { value: '20', label: '每页 20 条' },
                { value: '50', label: '每页 50 条' },
                { value: '100', label: '每页 100 条' },
              ]"
              class="h-7 w-28 text-[12.5px]"
              @update:model-value="pageSize = Number($event)"
            />
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-[12.5px]"
              :disabled="page <= 1"
              @click="page -= 1"
            ><ChevronLeft class="size-3.5" />上一页</Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-[12.5px]"
              :disabled="page >= pageCount"
              @click="page += 1"
            >下一页<ChevronRight class="size-3.5" /></Button>
          </div>
        </div>
      </div>

      <!-- 侧栏 -->
      <aside class="space-y-3">
        <div class="panel px-3.5 py-3">
          <div class="text-[13px] font-medium">最近 7 天任务趋势</div>
          <div class="text-[12px] text-muted-foreground">全站任务数与完成视频</div>
          <div class="mt-2 h-[170px]">
            <DailyTrend v-if="stats.length" :data="stats" />
            <Skeleton v-else class="h-full w-full" />
          </div>
        </div>

        <div class="panel px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div class="text-[13px] font-medium">最近错误</div>
            <span class="mono text-[12px] text-muted-foreground">{{ totals.errors }} 条</span>
          </div>
          <div v-if="recentErrors.length" class="mt-2 space-y-2">
            <button
              v-for="e in recentErrors"
              :key="e.key"
              class="block w-full border-b border-border/60 pb-2 text-left last:border-b-0 last:pb-0"
              @click="router.push(`/accounts/${e.job.accountUid}?from=history`)"
            >
              <div class="flex items-baseline gap-2">
                <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ relativeTime(e.job.startedAt) }}</span>
                <span class="min-w-0 flex-1 truncate text-[12.5px] text-coral">{{ e.message }}</span>
              </div>
              <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">{{ label(e.job.accountUid) }}</div>
            </button>
          </div>
          <p v-else class="mt-2.5 text-[12.5px] text-muted-foreground">最近记录中没有错误</p>
        </div>

        <div class="panel px-3.5 py-3">
          <div class="text-[13px] font-medium">状态构成</div>
          <div class="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <div class="bg-mint" :style="{ width: `${totalJobs ? (stateCounts.done / totalJobs) * 100 : 0}%` }" />
            <div class="bg-primary" :style="{ width: `${totalJobs ? (stateCounts.running / totalJobs) * 100 : 0}%` }" />
            <div class="bg-coral" :style="{ width: `${totalJobs ? (stateCounts.error / totalJobs) * 100 : 0}%` }" />
            <div class="bg-muted-foreground/40" :style="{ width: `${totalJobs ? (stateCounts.stopped / totalJobs) * 100 : 0}%` }" />
          </div>
          <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
            <div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-mint" /><span class="text-muted-foreground">完成</span><span class="mono ml-auto">{{ stateCounts.done }}</span></div>
            <div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-primary" /><span class="text-muted-foreground">运行</span><span class="mono ml-auto">{{ stateCounts.running }}</span></div>
            <div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-coral" /><span class="text-muted-foreground">出错</span><span class="mono ml-auto">{{ stateCounts.error }}</span></div>
            <div class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-muted-foreground/40" /><span class="text-muted-foreground">停止</span><span class="mono ml-auto">{{ stateCounts.stopped }}</span></div>
          </div>
        </div>
      </aside>
    </section>
  </div>
</template>
