<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  ExternalLink,
  FileEdit,
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
import WorkPanel from "@/components/account/WorkPanel.vue";
import StartJobDialog from "@/components/account/StartJobDialog.vue";
import ProgressRing from "@/components/charts/ProgressRing.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
import { isPending, runPending } from "@/lib/pending";
import { useExamStatus } from "@/composables/useExamStatus";
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

// 预先取回登录信息：点击时才能同步完成“复制 → 开窗”，避免新窗口抢焦点导致复制失败
const credentialsQuery = useQuery({
  queryKey: computed(() => ["credentials", props.uid]),
  queryFn: () => api.credentials(props.uid),
  enabled: computed(() => !!account.value),
  staleTime: 60_000,
  retry: 1,
});

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
const tab = ref<"courses" | "works" | "exams" | "logs" | "history">("courses");
const TABS = [
  { key: "courses", label: "课程进度", icon: BookOpen },
  { key: "works", label: "作业", icon: FileEdit },
  { key: "exams", label: "考试", icon: ClipboardList },
  { key: "logs", label: "实时日志", icon: ScrollText },
  { key: "history", label: "任务记录", icon: History },
] as const;

/** 课程标签下的考试节点状态：仅英华加载，考试标签与章节树共用同一份缓存 */
const examStatus = useExamStatus({
  accountUid: () => props.uid,
  courseId: () => courseId.value,
  platform: () => account.value?.platform,
  enabled: () => tab.value === "courses" && account.value?.platform === "YINGHUA",
});
const examBadges = computed<Record<string, { text: string; tone: string }>>(() => {
  const badges: Record<string, { text: string; tone: string }> = {};
  if (!account.value || account.value.platform !== "YINGHUA") return badges;
  for (const item of flatTree.value) {
    if (item.node.extra?.tabExam !== "true") continue;
    const result = examStatus.byNode.value[item.node.id];
    if (!result || result.error) continue;
    if (result.taken) {
      badges[item.node.id] = typeof result.score === "number"
        ? { text: `已考 ${result.score} 分`, tone: "text-mint" }
        : { text: "已参加", tone: "text-amber" };
    } else {
      badges[item.node.id] = { text: "未参加", tone: "text-muted-foreground" };
    }
  }
  return badges;
});

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
    if (r.stopped) toast.info("已请求停止，任务正在收尾");
    else toast.warning(r.reason ?? "任务已结束");
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

async function askStop() {
  if (!runningJob.value) return;
  if (isPending(`stop:${runningJob.value.id}`)) return;
  const ok = await confirmAction({
    title: "停止当前任务？",
    description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
    confirmText: "停止任务",
    tone: "danger",
  });
  if (ok && runningJob.value) {
    const id = runningJob.value.id;
    runPending(`stop:${id}`, () => stopMutation.mutateAsync(id));
  }
}

async function askRemove() {
  if (!account.value) return;
  if (isPending(`remove:${props.uid}`)) return;
  const name = account.value.remark || account.value.username;
  const ok = await confirmAction({
    title: `删除账号「${name}」？`,
    description: "账号信息、登录会话与定时关联都会被清除，历史任务记录仍保留，该操作不可撤销。",
    confirmText: "删除账号",
    tone: "danger",
  });
  if (ok) runPending(`remove:${props.uid}`, () => removeMutation.mutateAsync());
}

/**
 * 同步写剪贴板：必须在点击的同一帧内完成。
 * 若先开新窗口，焦点会被新窗口抢走，Clipboard API 和 execCommand 都会失败。
 */
function copyTextSync(text: string): boolean {
  const holder = document.createElement("textarea");
  holder.value = text;
  holder.setAttribute("readonly", "");
  holder.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
  document.body.appendChild(holder);
  holder.focus({ preventScroll: true });
  holder.select();
  holder.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(holder);
  return ok;
}

/** 一键打开平台，并把账号密码写入剪贴板 */
function openPlatform() {
  if (!account.value) return;
  const cred = credentialsQuery.data.value;
  if (!cred) {
    if (credentialsQuery.isError.value) toastError(credentialsQuery.error.value, "获取平台登录信息失败");
    else {
      toast.info("正在获取平台登录信息，请稍后重试");
      void credentialsQuery.refetch();
    }
    return;
  }

  // 先在当前窗口完成复制，再打开新窗口，避免新窗口抢焦点导致复制失败
  if (!cred.password) {
    toast.warning("密码不可用，请编辑账号重新保存后再试");
  } else {
    const copied = copyTextSync(`账号：${cred.username}\n密码：${cred.password}`);
    if (copied) toast.success("已复制账号密码，请在平台完成登录");
    else toast.error("复制失败，请手动填写账号密码");
  }

  const entry = cred.entryUrl || account.value.baseUrl || "";
  if (!entry) {
    toast.error("该账号没有可用的平台入口地址");
    return;
  }
  const opened = window.open(entry, "_blank");
  if (!opened) {
    toast.error("浏览器拦截了新窗口，请允许弹窗后重试");
    return;
  }
  try {
    opened.opener = null;
  } catch {
    // 跨域窗口可能不允许改 opener，忽略即可
  }
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
          <Button v-if="runningJob" variant="outline" size="sm" class="h-8 gap-1 text-[13px]" :disabled="isPending(`stop:${runningJob.id}`)" @click="askStop">
            <Square class="size-3.5" />停止任务
          </Button>
          <Button v-else size="sm" class="h-8 gap-1 text-[13px]" @click="startOpen = true">
            <Play class="size-3.5" />开始任务
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1 text-[13px]" @click="openPlatform">
            <ExternalLink class="size-3.5" />打开平台并复制
          </Button>
          <Button variant="outline" size="sm" class="h-8 gap-1 text-[13px]" :disabled="verifyMutation.isPending.value" @click="verifyMutation.mutate()">
            <RefreshCw class="size-3.5" />检测登录
          </Button>
          <span class="mx-1 h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" class="h-8 gap-1 text-[13px]" @click="addOpen = true">
            <Pencil class="size-3.5" />编辑
          </Button>
          <Button variant="ghost" size="sm" class="h-8 gap-1 text-[13px] text-muted-foreground hover:text-coral" :disabled="isPending(`remove:${props.uid}`)" @click="askRemove">
            <Trash2 class="size-3.5" />删除
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
              <span
                v-if="examBadges[item.node.id]"
                class="mono shrink-0 text-[12px]"
                :class="examBadges[item.node.id]?.tone"
              >{{ examBadges[item.node.id]?.text }}</span>
              <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ item.node.durationSeconds ? formatDuration(item.node.durationSeconds) : "—" }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 作业 -->
      <WorkPanel v-else-if="tab === 'works'" :account-uid="uid" :course-id="courseId" :platform="account?.platform" />

      <!-- 考试 -->
      <ExamPanel v-else-if="tab === 'exams'" :account-uid="uid" :course-id="courseId" :platform="account?.platform" />

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
