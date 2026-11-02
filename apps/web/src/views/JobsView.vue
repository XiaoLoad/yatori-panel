<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, AlertTriangle, Plus, Square, Trash2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState.vue";
import { useEventStore } from "@/stores/events";
import { relativeTime } from "@/lib/utils";
import { toastError } from "@/lib/errors";

const queryClient = useQueryClient();
const events = useEventStore();

const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 50 }),
  refetchInterval: 5000,
});
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const schedulesQuery = useQuery({
  queryKey: ["schedules"],
  queryFn: api.schedules,
  refetchInterval: 30_000,
});

function accountLabel(uid: string) {
  const a = accountsQuery.data.value?.find((x) => x.uid === uid);
  if (!a) return uid.slice(0, 8);
  return a.remark ? `${a.remark} · ${a.username}` : a.username;
}

function stateBadge(state?: string) {
  switch (state) {
    case "running":
      return { variant: "success" as const, text: "运行中" };
    case "done":
      return { variant: "secondary" as const, text: "已完成" };
    case "error":
      return { variant: "destructive" as const, text: "出错" };
    default:
      return { variant: "outline" as const, text: "已停止" };
  }
}

function modeText(mode: number) {
  return { 1: "普通", 2: "暴力", 3: "去红" }[mode] ?? mode;
}

function sourceText(source: string) {
  return { off: "不答题", ai: "AI 答题", bank: "题库答题" }[source] ?? source;
}

const runningJobs = computed(() =>
  (jobsQuery.data.value ?? []).filter((j) => j.state === "running"),
);

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

// 定时任务表单的类型收窄辅助
const scheduleVideoModeModel = computed({
  get: () => String(scheduleForm.value.videoMode),
  set: (v: string) => {
    scheduleForm.value.videoMode = Number(v) as 1 | 2 | 3;
  },
});

// ---------- 定时任务 ----------

const CRON_PRESETS = [
  { value: "0 2 * * *", label: "每天 02:00" },
  { value: "0 12 * * *", label: "每天 12:00" },
  { value: "0 */6 * * *", label: "每 6 小时" },
];

const scheduleDialogOpen = ref(false);
const scheduleForm = ref({
  accountUid: "",
  cron: "0 2 * * *",
  videoMode: 1,
  answerSource: "off",
  autoSubmit: false,
});

const accountOptions = computed(() =>
  (accountsQuery.data.value ?? []).map((a) => ({
    value: a.uid,
    label: a.remark ? `${a.remark} · ${a.username}` : a.username,
  })),
);

const cronPresetModel = computed({
  get: () => CRON_PRESETS.find((p) => p.value === scheduleForm.value.cron)?.value ?? "custom",
  set: (v: string) => {
    if (v !== "custom") scheduleForm.value.cron = v;
  },
});

function openScheduleDialog() {
  scheduleForm.value = {
    accountUid: accountOptions.value[0]?.value ?? "",
    cron: "0 2 * * *",
    videoMode: 1,
    answerSource: "off",
    autoSubmit: false,
  };
  scheduleDialogOpen.value = true;
}

const createScheduleMutation = useMutation({
  mutationFn: () =>
    api.createSchedule({
      accountUid: scheduleForm.value.accountUid,
      cron: scheduleForm.value.cron,
      videoMode: scheduleForm.value.videoMode as 1 | 2 | 3,
      answerSource: scheduleForm.value.answerSource as "off" | "ai" | "bank",
      autoSubmit: scheduleForm.value.autoSubmit,
    }),
  onSuccess: () => {
    toast.success("定时任务已创建");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    scheduleDialogOpen.value = false;
  },
  onError: (err) => toastError(err, "创建定时任务失败"),
});

function submitSchedule() {
  if (!scheduleForm.value.accountUid) {
    toast.error("请选择账号");
    return;
  }
  createScheduleMutation.mutate();
}

const deleteScheduleMutation = useMutation({
  mutationFn: (id: string) => api.deleteSchedule(id),
  onSuccess: () => {
    toast.success("定时任务已删除");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
  },
  onError: (err) => toastError(err, "删除定时任务失败"),
});

const toggleScheduleMutation = useMutation({
  mutationFn: (id: string) => api.toggleSchedule(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
  },
  onError: (err) => toastError(err, "切换定时任务失败"),
});

function scheduleAccountLabel(uid: string) {
  return accountLabel(uid);
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">任务控制台</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        发起任务请到「账号管理」的账号卡片上操作；这里负责监控与历史
      </p>
    </div>

    <!-- 运行中任务的实时视图 -->
    <div v-if="jobsQuery.isLoading.value" class="grid gap-4 lg:grid-cols-2">
      <Skeleton v-for="i in 2" :key="i" class="h-44 rounded-xl" />
    </div>
    <div v-else-if="runningJobs.length" class="grid gap-4 lg:grid-cols-2">
      <Card v-for="job in runningJobs" :key="job.id">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between gap-2">
            <CardTitle class="min-w-0 truncate text-base">{{ accountLabel(job.accountUid) }}</CardTitle>
            <Button variant="outline" size="sm" @click="stopMutation.mutate(job.id)">
              <Square />停止
            </Button>
          </div>
          <CardDescription>
            {{ modeText(job.options.videoMode) }}模式 · {{ sourceText(job.options.answerSource) }}
            · {{ job.options.courseIds.length ? `已选 ${job.options.courseIds.length} 门` : "全部课程" }}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <template v-if="events.jobLive[job.id]?.lastProgress">
            <div class="mb-1.5 flex items-baseline justify-between gap-3">
              <p class="min-w-0 truncate text-sm">
                {{ events.jobLive[job.id]!.lastProgress!.nodeName }}
              </p>
              <span class="shrink-0 text-lg font-bold tabular-nums leading-none">
                {{ Math.round(events.jobLive[job.id]!.lastProgress!.progress ?? 0) }}%
              </span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-primary/10">
              <div
                class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
                :style="{ width: `${Math.min(100, events.jobLive[job.id]!.lastProgress!.progress ?? 0)}%` }"
              />
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              {{ events.jobLive[job.id]!.lastProgress!.courseName }} · 已观看
              {{ events.jobLive[job.id]!.lastProgress!.watchedSeconds }}s /
              {{ events.jobLive[job.id]!.lastProgress!.totalSeconds || "?" }}s
            </p>
          </template>
          <div v-else class="space-y-2">
            <Skeleton class="h-4 w-3/4" />
            <Skeleton class="h-2 w-full" />
            <p class="text-xs text-muted-foreground">正在拉取课程与章节树…</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- 定时任务 -->
    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="flex items-center gap-2.5">
          <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
            <AlarmClock class="size-4 text-muted-foreground" />
          </div>
          <div class="space-y-0.5">
            <CardTitle class="text-base">定时任务</CardTitle>
            <CardDescription>按 cron 周期自动刷全部未完成课程</CardDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="openScheduleDialog">
          <Plus />新建
        </Button>
      </CardHeader>
      <CardContent>
        <div v-if="schedulesQuery.isLoading.value" class="space-y-2">
          <Skeleton v-for="i in 2" :key="i" class="h-10 w-full" />
        </div>
        <EmptyState
          v-else-if="!schedulesQuery.data.value?.length"
          :icon="AlarmClock"
          title="没有定时任务"
          description="例如每天凌晨 2 点自动挂机刷课"
        />
        <div v-else class="space-y-2">
          <div
            v-for="s in schedulesQuery.data.value"
            :key="s.id"
            class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
          >
            <Badge :variant="s.enabled ? 'success' : 'outline'">
              {{ s.enabled ? "启用" : "停用" }}
            </Badge>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ scheduleAccountLabel(s.accountUid) }}</div>
              <div class="text-xs text-muted-foreground">
                cron：<code class="rounded bg-muted px-1">{{ s.cron }}</code>
                · {{ modeText(s.videoMode) }}模式 · {{ sourceText(s.answerSource) }}
                <template v-if="s.lastRunAt">· 上次触发 {{ relativeTime(s.lastRunAt) }}</template>
              </div>
            </div>
            <Button variant="ghost" size="sm" @click="toggleScheduleMutation.mutate(s.id)">
              {{ s.enabled ? "停用" : "启用" }}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-destructive hover:text-destructive"
              @click="deleteScheduleMutation.mutate(s.id)"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 新建定时任务对话框 -->
    <Dialog v-model:open="scheduleDialogOpen">
      <form class="grid gap-4" @submit.prevent="submitSchedule">
        <div class="grid gap-1.5">
          <DialogTitle>新建定时任务</DialogTitle>
          <DialogDescription>到点自动以「全部未完成课程」发起任务</DialogDescription>
        </div>
        <div class="grid gap-2">
          <Label>账号</Label>
          <Select v-model="scheduleForm.accountUid" :options="accountOptions" placeholder="选择账号" />
        </div>
        <div class="grid gap-2">
          <Label>触发周期</Label>
          <Select v-model="cronPresetModel" :options="[...CRON_PRESETS, { value: 'custom', label: '自定义 ↓' }]" />
        </div>
        <div v-if="cronPresetModel === 'custom'" class="grid gap-2">
          <Label>cron 表达式</Label>
          <Input v-model="scheduleForm.cron" placeholder="0 2 * * *" />
          <p class="text-xs text-muted-foreground">分 时 日 月 周，例如 0 2 * * * = 每天 02:00</p>
        </div>
        <div class="grid gap-2">
          <Label>刷课模式</Label>
          <Select
            v-model="scheduleVideoModeModel"
            :options="[
              { value: '1', label: '普通模式' },
              { value: '2', label: '暴力模式（并发同刷，可能标红）' },
              { value: '3', label: '去红模式' },
            ]"
          />
        </div>
        <div class="grid gap-2">
          <Label>答题来源</Label>
          <Select
            v-model="scheduleForm.answerSource"
            :options="[
              { value: 'off', label: '不自动答题' },
              { value: 'ai', label: 'AI 答题（需在全局设置配置）' },
              { value: 'bank', label: '外置题库' },
            ]"
          />
        </div>
        <div class="flex items-center gap-3">
          <Switch v-model="scheduleForm.autoSubmit" />
          <Label class="font-normal">完成后自动提交</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" @click="scheduleDialogOpen = false">取消</Button>
          <Button type="submit" :disabled="createScheduleMutation.isPending.value">
            {{ createScheduleMutation.isPending.value ? "创建中…" : "创建" }}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>

    <!-- 标红提醒 -->
    <Card v-if="events.flags.length" class="border-amber-500/40">
      <CardHeader class="pb-2">
        <CardTitle class="flex items-center gap-2 text-base text-amber-600">
          <AlertTriangle class="size-4" />标红提醒
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-1 text-sm">
        <p
          v-for="flag in events.flags.slice(0, 5)"
          :key="`${flag.ts}-${flag.nodeId ?? ''}`"
          class="truncate text-muted-foreground"
        >
          {{ flag.courseName }} / {{ flag.nodeName }} — {{ flag.reason }}
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="space-y-1">
          <CardTitle class="text-base">任务历史</CardTitle>
          <CardDescription>最近 50 条</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="jobsQuery.isLoading.value" class="space-y-2">
          <Skeleton v-for="i in 4" :key="i" class="h-10 w-full" />
        </div>
        <EmptyState
          v-else-if="!jobsQuery.data.value?.length"
          :icon="Square"
          title="还没有任务"
          description="到「账号管理」的账号卡片上点击开始刷课"
        />
        <div v-else class="overflow-x-auto">
          <Table class="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead class="w-24">状态</TableHead>
                <TableHead>账号</TableHead>
                <TableHead class="w-40">配置</TableHead>
                <TableHead class="w-36">开始时间</TableHead>
                <TableHead>结果</TableHead>
                <TableHead class="w-20 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="job in jobsQuery.data.value" :key="job.id">
                <TableCell>
                  <Badge :variant="stateBadge(job.state).variant">{{ stateBadge(job.state).text }}</Badge>
                </TableCell>
                <TableCell class="min-w-0">
                  <span class="block truncate">{{ accountLabel(job.accountUid) }}</span>
                </TableCell>
                <TableCell class="text-muted-foreground">
                  {{ modeText(job.options.videoMode) }} · {{ sourceText(job.options.answerSource) }}
                </TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">
                  {{ relativeTime(job.startedAt) }}
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap items-center gap-1.5 text-xs" v-if="job.summary">
                    <Badge v-if="job.summary.videosCompleted" variant="secondary" class="tabular-nums">
                      视频 {{ job.summary.videosCompleted }}
                    </Badge>
                    <Badge v-if="job.summary.flagsFound" variant="warning" class="tabular-nums">
                      标红 {{ job.summary.flagsFound }}
                    </Badge>
                    <Badge v-if="job.summary.worksDone" variant="secondary" class="tabular-nums">
                      作业 {{ job.summary.worksDone }}
                    </Badge>
                    <Badge v-if="job.summary.examsDone" variant="secondary" class="tabular-nums">
                      考试 {{ job.summary.examsDone }}
                    </Badge>
                    <span
                      v-if="job.summary.errors?.length"
                      class="max-w-48 truncate text-red-500"
                      :title="job.summary.errors.join('；')"
                    >
                      {{ job.summary.errors.length }} 个错误
                    </span>
                    <span
                      v-if="!job.summary.videosCompleted && !job.summary.flagsFound && !job.summary.errors?.length"
                      class="text-muted-foreground"
                    >
                      -
                    </span>
                  </div>
                  <span v-else class="text-muted-foreground">-</span>
                </TableCell>
                <TableCell class="text-right">
                  <Button
                    v-if="job.state === 'running'"
                    variant="outline"
                    size="sm"
                    @click="stopMutation.mutate(job.id)"
                  >
                    停止
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
