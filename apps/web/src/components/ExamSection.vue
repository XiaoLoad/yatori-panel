<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ClipboardList, Loader2, Play } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { ExamDTO } from "@/api/resources";
import { api } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";

/**
 * 单门课程的考试列表与单场触发。
 * 触发后后台执行，过程经 SSE 实时展示（里程碑日志 + 网关会话日志），
 * 结束按得分/未确认/未提交三态提示。
 */
const props = defineProps<{
  accountUid: string;
  courseId: string;
}>();

const events = useEventStore();
const queryClient = useQueryClient();
const gatewayOffline = computed(() => events.gatewayStatus !== null && !events.gatewayStatus.up);

const examsQuery = useQuery({
  queryKey: computed(() => ["exams", props.accountUid, props.courseId]),
  queryFn: () => api.exams(props.accountUid, props.courseId),
  staleTime: 60_000,
});

// 该账号正在进行的单场考试（含本课程之外的，用于恢复"答题中"徽标）
const runningQuery = useQuery({
  queryKey: computed(() => ["exams-running", props.accountUid]),
  queryFn: () => api.runningExams(props.accountUid),
  refetchInterval: 5_000,
});

// ---------- 实时过程日志（SSE log 事件按本账号过滤） ----------
const liveLogs = ref<{ level: string; message: string }[]>([]);
// 全局事件流里本账号的 [单场考试] 日志 → 过程面板 + 结果 toast
watch(
  () => events.logs.length,
  () => {
    const last = events.logs[events.logs.length - 1];
    if (!last || last.accountId !== props.accountUid) return;
    if (!last.message?.startsWith("[单场考试]")) return;
    const message = last.message.replace("[单场考试] ", "");
    liveLogs.value.push({ level: last.level ?? "info", message });
    if (liveLogs.value.length > 50) liveLogs.value.shift();
    if (/完成，得分/.test(message)) {
      toast.success(message);
      void queryClient.invalidateQueries({ queryKey: ["exams-running", props.accountUid] });
      void queryClient.invalidateQueries({ queryKey: ["exams", props.accountUid, props.courseId] });
    } else if (/留空.*不交卷/.test(message)) {
      toast.warning(message);
      void queryClient.invalidateQueries({ queryKey: ["exams-running", props.accountUid] });
    } else if (/失败/.test(message)) {
      toast.error(message);
      void queryClient.invalidateQueries({ queryKey: ["exams-running", props.accountUid] });
    } else if (/已提交但未确认|已答题，未提交/.test(message)) {
      toast.info(message);
      void queryClient.invalidateQueries({ queryKey: ["exams-running", props.accountUid] });
    }
  },
);

// 答题源与交卷策略在区块级选择，逐场复用
const source = ref<"off" | "ai" | "bank">("ai");
const sourceOptions = [
  { value: "off", label: "仅拉取题目，不答题" },
  { value: "ai", label: "AI 答题（需在全局设置配置）" },
  { value: "bank", label: "外置题库（需在全局设置配置）" },
];
const submitMode = ref<"off" | "direct" | "smart">("smart");
const submitModeOptions = [
  { value: "off", label: "不交卷（答案仅保存为草稿）" },
  { value: "smart", label: "智能交卷（有留空则不交卷）" },
  { value: "direct", label: "直接交卷（答完立即交卷）" },
];

function isRunning(examId: string): boolean {
  return (runningQuery.data.value ?? []).some((r) => r.examId === examId);
}

const doExamMutation = useMutation({
  mutationFn: (exam: ExamDTO) =>
    api.doExam(props.accountUid, props.courseId, {
      examId: exam.id,
      examName: exam.name,
      source: source.value,
      submitMode: submitMode.value,
    }),
  onSuccess: () => {
    toast.info("已开始答题，过程实时展示在下方");
    void queryClient.invalidateQueries({ queryKey: ["exams-running", props.accountUid] });
  },
  onError: (err) => toastError(err, "考试触发失败"),
});

function statusBadge(status: string): { label: string; variant: "secondary" | "success" | "destructive" } {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("finish") || s.includes("complete")) return { label: "已完成", variant: "success" };
  if (s.includes("open") || s.includes("ing") || s.includes("start")) return { label: "进行中", variant: "secondary" };
  return { label: status || "未知", variant: "secondary" };
}
</script>

<template>
  <div class="rounded-lg border p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <ClipboardList class="size-4 text-muted-foreground" />
        <span class="text-sm font-semibold">考试</span>
        <Badge v-if="examsQuery.data.value?.length" variant="secondary">
          {{ examsQuery.data.value.length }}
        </Badge>
      </div>
      <Select v-model="source" class="w-56" :options="sourceOptions" />
      <Select v-model="submitMode" class="w-64" :options="submitModeOptions" />
    </div>

    <div v-if="examsQuery.isLoading.value" class="space-y-2">
      <Skeleton v-for="i in 2" :key="i" class="h-9 w-full" />
    </div>
    <p v-else-if="!(examsQuery.data.value ?? []).length" class="text-xs text-muted-foreground">
      该课程暂无考试
    </p>
    <div v-else class="space-y-1.5">
      <div
        v-for="exam in examsQuery.data.value"
        :key="exam.id"
        class="flex items-center gap-3 rounded-md border px-3 py-2"
      >
        <span class="min-w-0 flex-1 truncate text-sm">{{ exam.name }}</span>
        <Badge v-if="exam.questionCount" variant="secondary" class="shrink-0 tabular-nums">
          {{ exam.questionCount }} 题
        </Badge>
        <Badge :variant="statusBadge(exam.status).variant" class="shrink-0">
          {{ statusBadge(exam.status).label }}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          class="h-7 shrink-0 px-2 text-xs"
          :disabled="doExamMutation.isPending.value || gatewayOffline || isRunning(exam.id)"
          :title="gatewayOffline ? '网关离线——请先修复网关' : undefined"
          @click="doExamMutation.mutate(exam)"
        >
          <Loader2 v-if="isRunning(exam.id)" class="size-3 animate-spin" />
          <Play v-else class="size-3" />
          {{ isRunning(exam.id) ? "答题中" : "开始" }}
        </Button>
      </div>
    </div>

    <!-- 实时过程 -->
    <div v-if="liveLogs.length" class="mt-3 rounded-md border bg-muted/30 p-3">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">实时过程</p>
      <div class="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs leading-5">
        <p
          v-for="(l, i) in liveLogs"
          :key="i"
          :class="{
            'text-amber-600 dark:text-amber-400': l.level === 'warn',
            'text-red-600 dark:text-red-400': l.level === 'error',
          }"
        >
          {{ l.message }}
        </p>
      </div>
    </div>
    <p class="mt-2.5 text-xs text-muted-foreground">
      答题在后台进行，过程实时展示；也可到「实时日志」页查看全量输出
    </p>
  </div>
</template>
