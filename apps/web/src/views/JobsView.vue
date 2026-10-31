<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlertTriangle, Plus, Square } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { StartJobBody } from "@yatori/shared";
import { api, type CourseDTO } from "@/api/resources";
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
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEventStore } from "@/stores/events";

const queryClient = useQueryClient();
const events = useEventStore();

const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 50 }),
  refetchInterval: 5000,
});
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

function accountName(uid: string) {
  const a = accountsQuery.data.value?.find((x) => x.uid === uid);
  return a ? `${a.platformName} · ${a.username}` : uid.slice(0, 8);
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

// ---------- 发起任务 ----------

const dialogOpen = ref(false);
const form = reactive<StartJobBody>({
  accountUid: "",
  courseIds: [],
  videoMode: 1,
  answerSource: "off",
  autoSubmit: false,
  perCourseConcurrency: 4,
});

const accountOptions = computed(() =>
  (accountsQuery.data.value ?? []).map((a) => ({
    value: a.uid,
    label: `${a.platformName} · ${a.username}`,
  })),
);

const coursesQuery = useQuery({
  queryKey: computed(() => ["courses", form.accountUid]),
  queryFn: () => api.courses(form.accountUid),
  enabled: computed(() => !!form.accountUid && dialogOpen.value),
});

const incompleteCourses = computed(() =>
  (coursesQuery.data.value ?? []).filter((c) => c.progress < 100),
);

watch(
  () => form.accountUid,
  () => {
    form.courseIds = [];
  },
);

function toggleCourse(course: CourseDTO) {
  const i = form.courseIds.indexOf(course.id);
  if (i >= 0) form.courseIds.splice(i, 1);
  else form.courseIds.push(course.id);
}

// Select 组件以字符串为值类型，数字枚举经此转换
const videoModeModel = computed({
  get: () => String(form.videoMode),
  set: (v: string) => {
    form.videoMode = Number(v) as StartJobBody["videoMode"];
  },
});

const concurrencyModel = computed({
  get: () => String(form.perCourseConcurrency),
  set: (v: string) => {
    const n = Number(v);
    form.perCourseConcurrency = Math.min(16, Math.max(1, Number.isFinite(n) ? n : 1));
  },
});

function toggleAll() {
  const all = incompleteCourses.value.every((c) => form.courseIds.includes(c.id));
  form.courseIds = all ? [] : incompleteCourses.value.map((c) => c.id);
}

function openStart() {
  form.accountUid = accountOptions.value[0]?.value ?? "";
  form.courseIds = [];
  form.videoMode = 1;
  form.answerSource = "off";
  form.autoSubmit = false;
  form.perCourseConcurrency = 4;
  dialogOpen.value = true;
}

const startMutation = useMutation({
  mutationFn: (body: StartJobBody) => api.startJob(body),
  onSuccess: () => {
    toast.success("任务已启动");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    dialogOpen.value = false;
  },
  onError: (err) => toast.error((err as Error).message),
});

function submitStart() {
  if (!form.accountUid) {
    toast.error("请选择账号");
    return;
  }
  startMutation.mutate({
    accountUid: form.accountUid,
    courseIds: form.courseIds,
    videoMode: form.videoMode,
    answerSource: form.answerSource,
    autoSubmit: form.autoSubmit,
    perCourseConcurrency: form.perCourseConcurrency,
  });
}

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toast.error((err as Error).message),
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted-foreground">
        调度节奏：每 {{ 5 }} 秒提交一次学时；标红节点会被记录，可用去红模式重跑。
      </p>
      <Button @click="openStart"><Plus />发起任务</Button>
    </div>

    <!-- 运行中任务的实时视图 -->
    <div v-if="jobsQuery.data.value?.some((j) => j.state === 'running')" class="space-y-3">
      <Card v-for="job in jobsQuery.data.value.filter((j) => j.state === 'running')" :key="job.id">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-base">{{ accountName(job.accountUid) }}</CardTitle>
            <Button variant="outline" size="sm" @click="stopMutation.mutate(job.id)">
              <Square />停止
            </Button>
          </div>
          <CardDescription>
            {{ modeText(job.options.videoMode) }}模式 · {{ sourceText(job.options.answerSource) }}
            · 选中 {{ job.options.courseIds.length || "全部" }} 门课程
          </CardDescription>
        </CardHeader>
        <CardContent>
          <template v-if="events.jobLive[job.id]?.lastProgress">
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="min-w-0 truncate">
                {{ events.jobLive[job.id]!.lastProgress!.courseName }}
                / {{ events.jobLive[job.id]!.lastProgress!.nodeName }}
              </span>
              <span class="tabular-nums text-muted-foreground">
                {{ Math.round(events.jobLive[job.id]!.lastProgress!.progress ?? 0) }}%
                （{{ events.jobLive[job.id]!.lastProgress!.watchedSeconds }}s /
                {{ events.jobLive[job.id]!.lastProgress!.totalSeconds }}s）
              </span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all"
                :style="{ width: `${Math.min(100, events.jobLive[job.id]!.lastProgress!.progress ?? 0)}%` }"
              />
            </div>
          </template>
          <p v-else class="text-sm text-muted-foreground">正在准备任务（拉取课程/章节树）…</p>
        </CardContent>
      </Card>
    </div>

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
          class="text-muted-foreground"
        >
          {{ flag.courseName }} / {{ flag.nodeName }} — {{ flag.reason }}
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>任务历史</CardTitle>
        <CardDescription>最近 50 条</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>配置</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!jobsQuery.data.value?.length">
              <TableCell colspan="6" class="text-center text-muted-foreground">暂无任务</TableCell>
            </TableRow>
            <TableRow v-for="job in jobsQuery.data.value" :key="job.id">
              <TableCell>
                <Badge :variant="stateBadge(job.state).variant">{{ stateBadge(job.state).text }}</Badge>
              </TableCell>
              <TableCell>{{ accountName(job.accountUid) }}</TableCell>
              <TableCell class="text-muted-foreground">
                {{ modeText(job.options.videoMode) }} · {{ sourceText(job.options.answerSource) }}
              </TableCell>
              <TableCell class="whitespace-nowrap">
                {{ new Date(job.startedAt).toLocaleString() }}
              </TableCell>
              <TableCell class="max-w-64 truncate text-muted-foreground">
                <template v-if="job.summary">
                  视频 {{ job.summary.videosCompleted }} · 标红 {{ job.summary.flagsFound }} ·
                  作业 {{ job.summary.worksDone }} · 考试 {{ job.summary.examsDone }}
                  <span v-if="job.summary.errors?.length" class="text-red-500">
                    · {{ job.summary.errors.length }} 个错误
                  </span>
                </template>
                <template v-else-if="job.state === 'error'">登录或拉取课程失败</template>
                <template v-else>-</template>
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
      </CardContent>
    </Card>

    <!-- 发起任务 -->
    <Dialog v-model:open="dialogOpen">
      <div class="grid gap-4">
        <div class="grid gap-1.5">
          <DialogTitle>发起任务</DialogTitle>
          <DialogDescription>选择账号与课程范围，调度在面板后端执行</DialogDescription>
        </div>

        <div class="grid gap-2">
          <Label>账号</Label>
          <Select v-model="form.accountUid" :options="accountOptions" placeholder="选择账号" />
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label>课程范围</Label>
            <button
              v-if="incompleteCourses.length"
              class="text-xs text-muted-foreground underline-offset-2 hover:underline"
              @click="toggleAll"
            >
              {{ incompleteCourses.every((c) => form.courseIds.includes(c.id)) ? "取消全选" : "全选未完成" }}
            </button>
          </div>
          <div class="max-h-48 space-y-1 overflow-auto rounded-md border p-2">
            <p v-if="coursesQuery.isLoading.value" class="p-2 text-sm text-muted-foreground">
              课程加载中…
            </p>
            <p
              v-else-if="!coursesQuery.data.value?.length"
              class="p-2 text-sm text-muted-foreground"
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
                :checked="form.courseIds.includes(course.id)"
                @change="toggleCourse(course)"
              />
              <span class="min-w-0 flex-1 truncate">{{ course.name }}</span>
              <span class="text-xs tabular-nums text-muted-foreground">
                {{ Math.round(course.progress) }}%
              </span>
            </label>
          </div>
          <p class="text-xs text-muted-foreground">不勾选任何课程 = 刷全部课程</p>
        </div>

        <div class="grid gap-2">
          <Label>刷课模式</Label>
          <Select
            v-model="videoModeModel"
            :options="[
              { value: '1', label: '普通模式（按顺序串行）' },
              { value: '2', label: '暴力模式（并发同刷，可能标红）' },
              { value: '3', label: '去红模式（重跑未完成节点）' },
            ]"
          />
        </div>

        <div class="grid gap-2">
          <Label>答题来源</Label>
          <Select
            v-model="form.answerSource"
            :options="[
              { value: 'off', label: '不自动答题' },
              { value: 'ai', label: 'AI 答题（需在全局设置配置）' },
              { value: 'bank', label: '外置题库（需在全局设置配置）' },
            ]"
          />
        </div>

        <div v-if="form.videoMode === 2" class="grid gap-2">
          <Label>课程内并发数</Label>
          <Input v-model="concurrencyModel" type="number" min="1" max="16" />
        </div>

        <div class="flex items-center gap-3">
          <Switch v-model="form.autoSubmit" />
          <Label class="font-normal">作业/考试完成后自动提交</Label>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="dialogOpen = false">取消</Button>
          <Button :disabled="startMutation.isPending.value" @click="submitStart">
            {{ startMutation.isPending.value ? "启动中…" : "启动任务" }}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  </div>
</template>
