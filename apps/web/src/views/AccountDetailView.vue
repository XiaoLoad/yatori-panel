<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  History,
  Pencil,
  Play,
  RefreshCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession, NodeDTO } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AddAccountDialog from "@/components/account/AddAccountDialog.vue";
import ExamPanel from "@/components/account/ExamPanel.vue";
import StartJobDialog from "@/components/account/StartJobDialog.vue";
import ProgressRing from "@/components/charts/ProgressRing.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import {
  accountStatus,
  formatDuration,
  formatEta,
  jobStateLabel,
  overallPercent,
  phaseLabel,
  scheduleWindow,
  statusMeta,
} from "@/lib/account";
import { cn } from "@/lib/utils";

const props = defineProps<{ uid: string }>();

const router = useRouter();
const route = useRoute();
const queryClient = useQueryClient();
const events = useEventStore();

/** 从观测台/台账进入时返回原页面，从账号页进入时返回账号页 */
const backPath = computed(() => {
  if (route.query.from === "workspace") return "/";
  if (route.query.from === "history") return "/history";
  return "/accounts";
});
const backLabel = computed(() => {
  if (route.query.from === "workspace") return "观测台";
  if (route.query.from === "history") return "台账";
  return "账号";
});

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });
const schedulesQuery = useQuery({ queryKey: ["schedules"], queryFn: api.schedules, refetchInterval: 30_000 });
const jobsQuery = useQuery({
  queryKey: computed(() => ["jobs", props.uid]),
  queryFn: () => api.jobs({ accountUid: props.uid, limit: 30 }),
  refetchInterval: 5_000,
});

const account = computed<AccountWithSession | undefined>(() =>
  (accountsQuery.data.value ?? []).find((a) => a.uid === props.uid),
);

const platformName = computed(
  () =>
    account.value?.platformName ||
    (platformsQuery.data.value ?? []).find((p) => p.key === account.value?.platform)?.name ||
    account.value?.platform ||
    "",
);

const runningJob = computed<JobVO | null>(() => {
  const jobs = jobsQuery.data.value ?? [];
  return jobs.find((j) => j.state === "running") ?? null;
});

const latestJob = computed<JobVO | null>(() => (jobsQuery.data.value ?? [])[0] ?? null);
const progress = computed(() => {
  const running = runningJob.value;
  const live = running ? events.jobLive[running.id]?.lastProgress ?? null : null;
  return live ?? running?.progress ?? latestJob.value?.progress ?? null;
});

const status = computed(() => (account.value ? accountStatus(account.value, runningJob.value) : "idle"));
const percent = computed(() => {
  const p = progress.value?.progress;
  if (typeof p === "number") return Math.min(100, Math.max(0, Math.round(p)));
  return latestJob.value?.state === "done" ? 100 : 0;
});
/** 课程整体进度：优先使用任务汇总的时长统计 */
const overall = computed(() => overallPercent(progress.value));
const displayPercent = computed(() => overall.value ?? percent.value);

const schedule = computed<ScheduleVO | null>(() => {
  const uid = props.uid;
  for (const s of schedulesQuery.data.value ?? []) {
    if (s.enabled && s.accountUids.includes(uid)) return s;
  }
  return null;
});

// ---------- 课程与章节树 ----------
const coursesQuery = useQuery({
  queryKey: computed(() => ["courses", props.uid]),
  queryFn: () => api.courses(props.uid),
  enabled: computed(() => !!account.value),
  staleTime: 30_000,
});
const courseId = ref("");
watch(
  () => coursesQuery.data.value,
  (list) => {
    if (!courseId.value && list?.length) courseId.value = list[0]!.id;
  },
);
const currentCourse = computed(() => (coursesQuery.data.value ?? []).find((c) => c.id === courseId.value));

const treeQuery = useQuery({
  queryKey: computed(() => ["tree", props.uid, courseId.value]),
  queryFn: () => api.tree(props.uid, courseId.value),
  enabled: computed(() => !!courseId.value),
  staleTime: 30_000,
});

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
const treeStats = computed(() => {
  const total = flatTree.value.length;
  const completed = flatTree.value.filter((n) => n.node.completed).length;
  return { total, completed };
});

// ---------- 标签 ----------
const tab = ref<"courses" | "exams" | "logs" | "history">("courses");
const TABS = [
  { key: "courses", label: "课程进度", icon: BookOpen },
  { key: "exams", label: "考试", icon: ClipboardList },
  { key: "logs", label: "实时日志", icon: ScrollText },
  { key: "history", label: "任务记录", icon: History },
] as const;

// ---------- 日志 ----------
const logLevel = ref<"all" | "info" | "warn" | "error">("all");
const logs = computed(() => {
  const list = events.logs.filter(
    (l) => l.accountId === props.uid && (logLevel.value === "all" || l.level === logLevel.value),
  );
  return list.slice(-200);
});
function clockOf(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

// ---------- 操作 ----------
const startOpen = ref(false);
const addOpen = ref(false);

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

const verifyMutation = useMutation({
  mutationFn: () => api.verifyAccount(props.uid),
  onSuccess: (r) => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["courses", props.uid] });
    if (r.ok) toast.success(`登录正常，共 ${r.courseCount} 门课程`);
    else toast.warning("登录异常，请检查账号信息");
  },
  onError: (err) => toastError(err, "登录检测失败"),
});

const removeMutation = useMutation({
  mutationFn: () => api.deleteAccount(props.uid),
  onSuccess: () => {
    toast.success("账号已删除");
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void router.push("/accounts");
  },
  onError: (err) => toastError(err, "删除账号失败"),
});

function askRemove() {
  if (!account.value) return;
  const name = account.value.remark || account.value.username;
  if (!window.confirm(`删除账号「${name}」？该操作不可撤销。`)) return;
  removeMutation.mutate();
}

function startedAt(job: JobVO): string {
  return new Date(job.startedAt).toLocaleString("zh-CN", { hour12: false });
}
function durationOf(job: JobVO): string {
  if (!job.finishedAt) return runningJob.value?.id === job.id ? "进行中" : "—";
  const sec = (new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000;
  return formatDuration(sec);
}

const summaryOfLatest = computed(() => latestJob.value?.summary ?? null);
</script>

<template>
  <div v-if="!account && !accountsQuery.isLoading.value" class="panel px-6 py-16 text-center">
    <h1 class="text-[16px] font-semibold">账号不存在或已被删除</h1>
    <RouterLink :to="backPath" class="mt-3 inline-block text-[14px] text-primary hover:underline">返回{{ backLabel }}</RouterLink>
  </div>

  <div v-else class="space-y-4">
    <nav class="flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <RouterLink :to="backPath" class="inline-flex items-center gap-1 hover:text-foreground">
        <ArrowLeft class="size-3.5" />{{ backLabel }}
      </RouterLink>
      <span>/</span>
      <span class="text-foreground">{{ account?.remark || account?.username || "加载中" }}</span>
    </nav>

    <!-- 账号头部 -->
    <section class="panel overflow-hidden">
      <div class="flex flex-wrap items-start gap-4 p-4">
        <div class="grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-panel-2 text-[18px] font-semibold text-primary">
          {{ (account?.remark || account?.username || "?").slice(0, 1) }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-[20px] font-semibold leading-none">{{ account?.remark || account?.username }}</h1>
            <span class="mono rounded border border-border px-1.5 py-0.5 text-[12px] text-muted-foreground">{{ platformName }}</span>
            <span class="flex items-center gap-1.5 text-[13px]" :class="statusMeta(status).text">
              <span class="size-1.5 rounded-full" :class="[statusMeta(status).dot, status === 'running' && 'animate-breathe']" />
              {{ statusMeta(status).label }}
            </span>
            <span v-if="!account?.enabled" class="rounded bg-muted px-1.5 text-[12px] text-muted-foreground">已停用</span>
          </div>
          <div class="mono mt-1.5 text-[12.5px] text-muted-foreground">
            {{ account?.username }}
            <template v-if="account?.baseUrl"> · {{ account.baseUrl }}</template>
            <template v-if="account?.proxyUrl"> · 代理 {{ account.proxyUrl }}</template>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button v-if="runningJob" variant="outline" size="sm" class="h-8 gap-1 text-[13px]" @click="stopMutation.mutate(runningJob.id)">
            <Square class="size-3.5" />停止任务
          </Button>
          <Button v-else size="sm" class="h-8 gap-1 text-[13px]" @click="startOpen = true">
            <Play class="size-3.5" />开始任务
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1 text-[13px]" @click="verifyMutation.mutate()">
            <RefreshCw class="size-3.5" />检测登录
          </Button>
          <Button variant="ghost" size="icon" class="size-8" title="编辑账号" @click="addOpen = true">
            <Pencil class="size-4" />
          </Button>
          <Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-coral" title="删除账号" @click="askRemove">
            <Trash2 class="size-4" />
          </Button>
        </div>
      </div>

      <div class="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <div class="bg-card px-4 py-2.5">
          <div class="text-[12px] text-muted-foreground">会话状态</div>
          <div class="mt-0.5 text-[14px]">{{ account?.hasSession ? "已建立会话" : "未建立会话" }}</div>
        </div>
        <div class="bg-card px-4 py-2.5">
          <div class="text-[12px] text-muted-foreground">上次登录检测</div>
          <div class="mono mt-0.5 text-[13.5px]">
            {{ account?.lastVerifyAt ? new Date(account.lastVerifyAt).toLocaleString("zh-CN", { hour12: false }) : "—" }}
          </div>
        </div>
        <div class="bg-card px-4 py-2.5">
          <div class="text-[12px] text-muted-foreground">定时规则</div>
          <div class="mono mt-0.5 truncate text-[13.5px]">{{ scheduleWindow(schedule)?.time ?? "未设定时" }}</div>
        </div>
        <div class="bg-card px-4 py-2.5">
          <div class="text-[12px] text-muted-foreground">课程数量</div>
          <div class="mono mt-0.5 text-[14px]">{{ coursesQuery.data.value?.length ?? 0 }} 门</div>
        </div>
      </div>
    </section>

    <!-- 当前任务进度 -->
    <section class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="panel p-4">
        <div class="flex items-start gap-4">
          <ProgressRing :value="displayPercent" :size="66" :stroke="6" :tone="status === 'running' ? 'primary' : 'muted'" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                :class="cn(
                  'stage-chip',
                  status === 'running' ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground',
                )"
              >{{ phaseLabel(progress, status === 'running') }}</span>
              <span class="mono text-[12.5px] text-muted-foreground">{{ status === "running" ? "运行中" : "当前无任务" }}</span>
              <span v-if="runningJob" class="mono text-[12.5px] text-muted-foreground">开始于 {{ startedAt(runningJob) }}</span>
            </div>
            <div class="mt-1.5 truncate text-[15px]">
              {{ progress?.courseName || currentCourse?.name || runningJob?.accountName || "等待任务启动" }}
            </div>
            <div class="mono mt-1 truncate text-[12.5px] text-muted-foreground">
              <template v-if="progress?.watchedSeconds !== undefined">
                已看 {{ formatDuration(progress.watchedSeconds) }}
                <template v-if="progress?.totalSeconds"> / {{ formatDuration(progress.totalSeconds) }}</template>
              </template>
              <template v-else>{{ progress?.nodeName || "发起任务后此处显示课程与节点进度" }}</template>
            </div>
            <div v-if="overall !== null" class="mono mt-1 truncate text-[12.5px] text-muted-foreground">
              课程整体 {{ overall }}% · 课程 {{ progress?.courseCount ?? 0 }} 门 · 剩 {{ progress?.coursesRemaining ?? 0 }} 门
            </div>
            <div v-if="status === 'running' && progress?.etaSeconds !== undefined" class="mt-0.5 text-[12.5px] text-muted-foreground">
              预计还需 {{ formatEta(progress.etaSeconds) }}（按当前课程并发估算）
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-primary transition-[width] duration-500" :style="{ width: `${displayPercent}%` }" />
            </div>
          </div>
        </div>
      </div>

      <div class="panel p-4">
        <div class="text-[13px] font-medium">最近一次任务产出</div>
        <div v-if="summaryOfLatest" class="mt-2.5 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-md border border-border bg-panel-2 py-2">
            <div class="mono text-[18px] font-semibold leading-none">{{ summaryOfLatest.videosCompleted }}</div>
            <div class="mt-1 text-[12px] text-muted-foreground">视频</div>
          </div>
          <div class="rounded-md border border-border bg-panel-2 py-2">
            <div class="mono text-[18px] font-semibold leading-none">{{ summaryOfLatest.worksDone }}</div>
            <div class="mt-1 text-[12px] text-muted-foreground">作业</div>
          </div>
          <div class="rounded-md border border-border bg-panel-2 py-2">
            <div class="mono text-[18px] font-semibold leading-none">{{ summaryOfLatest.examsDone }}</div>
            <div class="mt-1 text-[12px] text-muted-foreground">考试</div>
          </div>
        </div>
        <div v-if="summaryOfLatest" class="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>课程 {{ summaryOfLatest.courses }}</span>
          <span>跳过 {{ summaryOfLatest.videosSkipped }}</span>
          <span>标记 {{ summaryOfLatest.flagsFound }}</span>
          <span :class="summaryOfLatest.errors.length ? 'text-coral' : ''">错误 {{ summaryOfLatest.errors.length }}</span>
        </div>
        <p v-if="!summaryOfLatest" class="mt-3 text-[13px] text-muted-foreground">暂无任务记录</p>
        <div v-if="summaryOfLatest?.scores.length" class="mt-2 space-y-0.5">
          <div v-for="(s, i) in summaryOfLatest.scores.slice(0, 3)" :key="i" class="truncate text-[12.5px] text-muted-foreground">{{ s }}</div>
        </div>
      </div>
    </section>

    <!-- 明细标签 -->
    <section class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-4 border-b border-border px-4">
        <button
          v-for="t in TABS"
          :key="t.key"
          :class="cn(
            'relative flex items-center gap-1.5 py-2.5 text-[14px] transition-colors',
            tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="tab = t.key"
        >
          <component :is="t.icon" class="size-4" />{{ t.label }}
          <span v-if="tab === t.key" class="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
        </button>
        <div class="ml-auto flex items-center gap-1" v-if="tab === 'logs'">
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
          >{{ l.label }}</button>
        </div>
      </div>

      <!-- 课程进度 -->
      <div v-if="tab === 'courses'" class="grid gap-0 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div class="border-b border-border lg:border-b-0 lg:border-r">
          <div class="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-muted-foreground">
            <span>课程列表</span>
            <span class="mono">{{ coursesQuery.data.value?.length ?? 0 }} 门</span>
          </div>
          <div v-if="coursesQuery.isLoading.value" class="space-y-2 px-4 pb-4">
            <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
          </div>
          <div v-else-if="!(coursesQuery.data.value ?? []).length" class="px-4 py-10 text-center text-[13px] text-muted-foreground">
            未获取到课程，请先检测登录
          </div>
          <div v-else class="max-h-[420px] overflow-y-auto">
            <button
              v-for="course in coursesQuery.data.value ?? []"
              :key="course.id"
              :class="cn(
                'flex w-full flex-col gap-1.5 border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-b-0',
                courseId === course.id ? 'bg-primary/5' : 'hover:bg-accent/60',
              )"
              @click="courseId = course.id"
            >
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-[13.5px]">{{ course.name }}</span>
                <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ Math.round(course.progress) }}%</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.round(course.progress)}%` }" />
                </div>
                <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ course.teacher || "—" }}</span>
              </div>
            </button>
          </div>
        </div>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
            <span class="min-w-0 truncate text-[14px] font-medium">{{ currentCourse?.name || "章节树" }}</span>
            <span class="mono text-[12.5px] text-muted-foreground">
              节点 {{ treeStats.completed }} / {{ treeStats.total }} 已完成
            </span>
            <div class="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
              <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-mint" />已完成</span>
              <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-amber" />进行中</span>
              <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-border" />未开始</span>
            </div>
          </div>
          <div v-if="treeQuery.isLoading.value" class="space-y-1.5 p-4">
            <Skeleton v-for="i in 6" :key="i" class="h-7 w-full" />
          </div>
          <div v-else-if="!flatTree.length" class="px-4 py-12 text-center text-[13px] text-muted-foreground">
            选择课程后加载章节节点
          </div>
          <div v-else class="max-h-[420px] overflow-y-auto py-1">
            <div
              v-for="item in flatTree"
              :key="item.node.id"
              class="flex items-center gap-2.5 border-b border-border/40 px-4 py-1.5 text-[13.5px] last:border-b-0"
              :class="item.node.children?.length ? 'font-medium text-foreground' : 'text-foreground/80'"
              :style="{ paddingLeft: `${16 + item.depth * 16}px` }"
            >
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="item.node.completed ? 'bg-mint' : item.node.progress > 0 ? 'bg-amber' : 'bg-border'"
              />
              <span class="min-w-0 flex-1 truncate">{{ item.node.name }}</span>
              <span v-if="item.node.progress > 0 && !item.node.completed" class="mono shrink-0 text-[12px] text-amber">{{ Math.round(item.node.progress) }}%</span>
              <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ item.node.durationSeconds ? formatDuration(item.node.durationSeconds) : "—" }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 考试 -->
      <ExamPanel v-else-if="tab === 'exams'" :account-uid="uid" :course-id="courseId" />

      <!-- 日志 -->
      <div v-else-if="tab === 'logs'">
        <div v-if="logs.length" class="max-h-[420px] overflow-y-auto px-4 py-1">
          <div
            v-for="(l, i) in logs.slice().reverse()"
            :key="i"
            class="flex items-baseline gap-2.5 border-b border-border/50 py-1.5 last:border-b-0"
          >
            <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ clockOf(l.ts) }}</span>
            <span
              :class="cn(
                'mono w-10 shrink-0 text-[12px] uppercase',
                l.level === 'error' ? 'text-coral' : l.level === 'warn' ? 'text-amber' : 'text-primary/80',
              )"
            >{{ l.level ?? "info" }}</span>
            <span class="min-w-0 flex-1 text-[13px] text-foreground/85">{{ l.message }}</span>
          </div>
        </div>
        <p v-else class="px-4 py-12 text-center text-[13px] text-muted-foreground">
          暂无该账号的实时日志，发起任务后会自动出现
        </p>
      </div>

      <!-- 任务记录 -->
      <div v-else>
        <div v-if="jobsQuery.isLoading.value" class="space-y-2 p-4">
          <Skeleton v-for="i in 4" :key="i" class="h-10 w-full" />
        </div>
        <div v-else-if="!(jobsQuery.data.value ?? []).length" class="px-4 py-12 text-center text-[13px] text-muted-foreground">
          还没有任务记录
        </div>
        <div v-else class="overflow-x-auto">
          <div class="hidden min-w-[760px] grid-cols-[92px_minmax(0,1fr)_120px_96px] gap-3 border-b border-border bg-panel-2 px-4 py-1.5 text-[12px] text-muted-foreground md:grid">
            <span>状态</span>
            <span>开始时间</span>
            <span>耗时</span>
            <span class="text-right">产出</span>
          </div>
          <div
            v-for="job in jobsQuery.data.value ?? []"
            :key="job.id"
            class="grid min-w-[760px] grid-cols-[92px_minmax(0,1fr)_120px_96px] items-center gap-3 border-b border-border/60 px-4 py-2 text-[13px] last:border-b-0"
          >
            <span
              :class="cn(
                'w-fit rounded px-1.5 py-0.5 text-[12.5px]',
                job.state === 'running'
                  ? 'bg-primary/10 text-primary'
                  : job.state === 'error'
                    ? 'bg-coral/10 text-coral'
                    : job.state === 'done'
                      ? 'bg-mint/10 text-mint'
                      : 'bg-muted text-muted-foreground',
              )"
            >{{ jobStateLabel(job.state) }}</span>
            <span class="mono truncate text-[12.5px]">{{ startedAt(job) }}</span>
            <span class="mono text-[12.5px] text-muted-foreground">{{ durationOf(job) }}</span>
            <span class="mono text-right text-[12.5px]">
              {{ job.summary ? `视频 ${job.summary.videosCompleted} · 作业 ${job.summary.worksDone} · 考试 ${job.summary.examsDone}` : "—" }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <AddAccountDialog
      v-model:open="addOpen"
      :account="account ?? null"
      @saved="queryClient.invalidateQueries({ queryKey: ['accounts'] })"
    />
    <StartJobDialog
      v-model:open="startOpen"
      :accounts="account ? [{ uid: account.uid, label: account.remark || account.username }] : []"
    />
  </div>
</template>
