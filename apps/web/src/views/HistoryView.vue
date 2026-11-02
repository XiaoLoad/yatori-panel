<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { History, Square } from "lucide-vue-next";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import type { JobVO } from "@yatori/shared";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/utils";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const queryClient = useQueryClient();
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 80 }),
  refetchInterval: 5_000,
});

const accountFilter = ref("all");
const stateFilter = ref<"all" | "running" | "done" | "stopped" | "error">("all");

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

const allJobs = computed(() => jobsQuery.data.value ?? []);
const jobs = computed(() =>
  allJobs.value.filter((j) => {
    if (accountFilter.value !== "all" && j.accountUid !== accountFilter.value) return false;
    if (stateFilter.value !== "all" && j.state !== stateFilter.value) return false;
    return true;
  }),
);

const stateCounts = computed(() => {
  const c = { running: 0, done: 0, stopped: 0, error: 0 };
  for (const j of allJobs.value) c[j.state] += 1;
  return c;
});
const totalJobs = computed(() => allJobs.value.length);

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

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
</script>

<template>
  <div class="space-y-4">
    <header>
      <div class="eyebrow">Operation ledger</div>
      <h1 class="display-title mt-1.5 text-[26px] leading-none">台账</h1>
      <p class="mt-2 text-[11.5px] text-muted-foreground">最近 80 条任务记录，运行中的任务可直接停止</p>
    </header>

    <div class="panel flex flex-wrap items-center gap-4 px-4 py-3">
      <div class="flex items-baseline gap-2">
        <span class="mono text-[22px] font-semibold leading-none">{{ totalJobs }}</span>
        <span class="mono text-[9px] text-muted-foreground">JOBS</span>
      </div>
      <div class="h-6 w-px bg-border" />
      <div class="min-w-[220px] flex-1">
        <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            v-for="seg in [
              { key: 'running', value: stateCounts.running, color: 'var(--mint)' },
              { key: 'done', value: stateCounts.done, color: 'var(--ice)' },
              { key: 'stopped', value: stateCounts.stopped, color: 'var(--muted-foreground)' },
              { key: 'error', value: stateCounts.error, color: 'var(--coral)' },
            ]"
            :key="seg.key"
            class="h-full transition-[width]"
            :style="{ width: `${totalJobs ? (seg.value / totalJobs) * 100 : 0}%`, background: seg.color }"
          />
        </div>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span class="mono flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span class="size-1.5 rounded-full" style="background: var(--mint)" />运行 {{ stateCounts.running }}
          </span>
          <span class="mono flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span class="size-1.5 rounded-full" style="background: var(--ice)" />完成 {{ stateCounts.done }}
          </span>
          <span class="mono flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span class="size-1.5 rounded-full" style="background: var(--coral)" />出错 {{ stateCounts.error }}
          </span>
          <span class="mono flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span class="size-1.5 rounded-full" style="background: var(--muted-foreground)" />停止 {{ stateCounts.stopped }}
          </span>
        </div>
      </div>
      <Select v-model="accountFilter" :options="accountOptions" class="h-8 w-44 text-[11px]" />
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="s in [
          { key: 'all', label: '全部' },
          { key: 'running', label: '运行中' },
          { key: 'done', label: '已完成' },
          { key: 'stopped', label: '已停止' },
          { key: 'error', label: '出错' },
        ] as const"
        :key="s.key"
        :class="cn('rounded-full border px-2.5 py-1 text-[10.5px] transition-colors', stateFilter === s.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
        @click="stateFilter = s.key"
      >{{ s.label }}</button>
    </div>

    <div v-if="jobsQuery.isLoading.value" class="panel space-y-2 p-4">
      <Skeleton v-for="i in 6" :key="i" class="h-11 w-full" />
    </div>
    <div v-else-if="!jobs.length" class="panel px-6 py-16 text-center">
      <div class="mx-auto grid size-12 place-items-center rounded-2xl border border-border bg-panel-2 text-muted-foreground">
        <History class="size-5" />
      </div>
      <h2 class="mt-4 text-[14px] font-semibold">还没有任务记录</h2>
      <p class="mt-1 text-[11.5px] text-muted-foreground">到观测台勾选账号并点击「发起任务」</p>
    </div>
    <div v-else class="panel overflow-x-auto">
      <div class="min-w-[940px]">
        <div class="grid grid-cols-[80px_minmax(140px,1fr)_170px_110px_minmax(0,1.6fr)_64px] gap-3 border-b border-border bg-panel-2/60 px-4 py-1.5">
          <span class="eyebrow !text-[8px]">状态</span>
          <span class="eyebrow !text-[8px]">账号</span>
          <span class="eyebrow !text-[8px]">配置</span>
          <span class="eyebrow !text-[8px]">开始时间</span>
          <span class="eyebrow !text-[8px]">结果</span>
          <span class="eyebrow !text-right !text-[8px]">操作</span>
        </div>
        <div
          v-for="job in jobs"
          :key="job.id"
          class="grid grid-cols-[80px_minmax(140px,1fr)_170px_110px_minmax(0,1.6fr)_64px] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[11px] last:border-b-0 hover:bg-accent/20"
        >
          <span
            :class="cn(
              'mono w-fit rounded-full border px-2 py-0.5 text-[9px]',
              job.state === 'running' && 'border-mint/30 bg-mint/10 text-mint',
              job.state === 'done' && 'border-ice/30 bg-ice/10 text-ice',
              job.state === 'error' && 'border-coral/30 bg-coral/10 text-coral',
              job.state === 'stopped' && 'border-border text-muted-foreground',
            )"
          >{{ stateLabel(job.state) }}</span>
          <span class="truncate">{{ label(job.accountUid) }}</span>
          <span class="mono truncate text-[9.5px] text-muted-foreground">
            {{ modeText(job.options.videoMode) }} · {{ sourceText(job.options.answerSource) }} · {{ submitText(job.options.submitMode) }}
          </span>
          <span class="mono text-[9.5px] text-muted-foreground">{{ relativeTime(job.startedAt) }}</span>
          <span class="flex flex-wrap items-center gap-1 text-[9px]">
            <template v-if="job.summary">
              <span v-if="job.summary.videosCompleted" class="mono rounded bg-muted px-1.5 py-0.5">视频 {{ job.summary.videosCompleted }}</span>
              <span v-if="job.summary.worksDone" class="mono rounded bg-muted px-1.5 py-0.5">作业 {{ job.summary.worksDone }}</span>
              <span v-if="job.summary.examsDone" class="mono rounded bg-muted px-1.5 py-0.5">考试 {{ job.summary.examsDone }}</span>
              <span v-if="job.summary.flagsFound" class="mono rounded bg-amber/10 px-1.5 py-0.5 text-amber">标红 {{ job.summary.flagsFound }}</span>
              <span v-if="job.summary.errors?.length" class="mono text-coral">{{ job.summary.errors.length }} ERR</span>
              <span v-if="!job.summary.videosCompleted && !job.summary.flagsFound && !job.summary.errors?.length" class="text-muted-foreground">—</span>
            </template>
            <span v-else class="text-muted-foreground">—</span>
          </span>
          <span class="flex justify-end">
            <Button
              v-if="job.state === 'running'"
              variant="outline"
              size="sm"
              class="h-6 gap-1 px-2 text-[9.5px]"
              @click="stopMutation.mutate(job.id)"
            ><Square class="size-3" />停止</Button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
