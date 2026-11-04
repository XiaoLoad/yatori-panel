<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Loader2, Play } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { ExamDTO } from "@/api/resources";
import { api } from "@/api/resources";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { useExamStatus } from "@/composables/useExamStatus";

const props = defineProps<{ accountUid: string; courseId: string; platform?: string }>();

const events = useEventStore();
const queryClient = useQueryClient();
const gatewayOffline = computed(() => events.gatewayStatus !== null && !events.gatewayStatus.up);

const { examsQuery, resultsQuery, byExam } = useExamStatus({
  accountUid: () => props.accountUid,
  courseId: () => props.courseId,
  platform: () => props.platform,
});

const runningQuery = useQuery({
  queryKey: computed(() => ["drawer-exams-running", props.accountUid]),
  queryFn: () => api.runningExams(props.accountUid),
  refetchInterval: 5_000,
});

const source = ref<"off" | "ai" | "bank">("bank");
const submitMode = ref<"off" | "direct" | "smart">("off");

const sourceOptions = [
  { value: "off", label: "仅拉取题目，不答题" },
  { value: "ai", label: "AI 答题（需在全局设置配置）" },
  { value: "bank", label: "外置题库（需在全局设置配置）" },
];
const submitOptions = [
  { value: "off", label: "不交卷（仅保存草稿）" },
  { value: "smart", label: "智能交卷（有留空则不交卷）" },
  { value: "direct", label: "直接交卷" },
];

const liveLogs = ref<{ level: string; message: string }[]>([]);
const progress = ref<{ current: number; total: number } | null>(null);

watch(
  () => events.logs.length,
  () => {
    const last = events.logs[events.logs.length - 1];
    if (!last || last.accountId !== props.accountUid) return;
    if (!last.message?.startsWith("[单场考试]")) return;
    const message = last.message.replace("[单场考试] ", "");
    liveLogs.value.push({ level: last.level ?? "info", message });
    if (liveLogs.value.length > 40) liveLogs.value.shift();
    const m = message.match(/第 (\d+)\/(\d+) 题/);
    if (m) {
      progress.value = { current: Number(m[1]), total: Number(m[2]) };
    } else if (/开始（|逐题模式开始/.test(message)) {
      progress.value = null;
    }
    if (/完成，得分|已交卷|失败|留空.*不交卷|已提交但未确认/.test(message)) {
      progress.value = null;
      void queryClient.invalidateQueries({ queryKey: ["drawer-exams-running", props.accountUid] });
      void queryClient.invalidateQueries({ queryKey: ["drawer-exams", props.accountUid, props.courseId] });
    }
  },
);

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
    toast.info("已开始答题，过程可在日志标签查看");
    void queryClient.invalidateQueries({ queryKey: ["drawer-exams-running", props.accountUid] });
  },
  onError: (err) => toastError(err, "考试触发失败"),
});

function statusText(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("finish") || s.includes("complete")) return "已完成";
  if (s.includes("open") || s.includes("ing") || s.includes("start")) return "进行中";
  return status || "未知";
}

/** 按考试时间推导开放状态，避免英华 status 恒为空显示「未知」 */
function availabilityOf(exam: ExamDTO): string {
  const now = Date.now();
  const start = exam.startAt ? Date.parse(exam.startAt) : NaN;
  const end = exam.endAt ? Date.parse(exam.endAt) : NaN;
  if (Number.isFinite(start) && now < start) return "未开始";
  if (Number.isFinite(end) && now > end) return "已截止";
  return "可参加";
}

function stateOf(exam: ExamDTO): string {
  return props.platform === "YINGHUA" ? availabilityOf(exam) : statusText(exam.status);
}

/** 只读查询到的参与状态：已参加显示最终得分，未参加/成绩未出明确区分 */
function resultOf(exam: ExamDTO): { text: string; tone: string } | null {
  if (props.platform !== "YINGHUA") return null;
  const r = byExam.value[exam.id];
  if (!r) return null;
  if (r.error) return { text: "状态查询失败", tone: "text-coral" };
  if (r.taken && typeof r.score === "number") return { text: `已参加 · ${r.score} 分`, tone: "text-mint" };
  if (r.taken) return { text: "已参加 · 成绩未出", tone: "text-amber" };
  return { text: "未参加", tone: "text-muted-foreground" };
}

const resultError = computed(() =>
  props.platform === "YINGHUA" && resultsQuery.isError.value
    ? ((resultsQuery.error.value as Error)?.message ?? "查询失败")
    : "",
);
</script>

<template>
  <div class="p-3.5">
    <div class="mb-2 grid gap-1.5">
      <Select v-model="source" :options="sourceOptions" />
      <Select v-model="submitMode" :options="submitOptions" />
    </div>

    <p
      v-if="resultError"
      class="mb-2 rounded-md border border-coral/30 bg-coral/10 px-2.5 py-1.5 text-[12px] text-coral"
    >
      考试状态查询失败：{{ resultError }}
    </p>

    <div v-if="!courseId" class="py-8 text-center text-[13.5px] text-muted-foreground">
      先从课程标签选择一门课程
    </div>
    <div v-else-if="examsQuery.isLoading.value" class="space-y-1.5">
      <Skeleton v-for="i in 3" :key="i" class="h-8 w-full" />
    </div>
    <p v-else-if="!(examsQuery.data.value ?? []).length" class="py-8 text-center text-[13.5px] text-muted-foreground">
      该课程暂无考试
    </p>
    <div v-else class="space-y-1.5">
      <div
        v-for="exam in examsQuery.data.value"
        :key="exam.id"
        class="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-[14px]">{{ exam.name }}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span v-if="exam.extra?.score" class="mono">满分 {{ exam.extra.score }}</span>
            <span>{{ exam.questionCount ? `${exam.questionCount} 题` : "题量未知" }}</span>
            <span>{{ stateOf(exam) }}</span>
            <span
              v-if="resultOf(exam)"
              class="mono"
              :class="resultOf(exam)?.tone"
              :title="byExam[exam.id]?.message"
            >{{ resultOf(exam)?.text }}</span>
            <span v-else-if="platform === 'YINGHUA' && resultsQuery.isLoading.value" class="text-primary/80">状态查询中…</span>
          </div>
        </div>
        <button
          class="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
          :disabled="doExamMutation.isPending.value || gatewayOffline || isRunning(exam.id)"
          @click="doExamMutation.mutate(exam)"
        >
          <Loader2 v-if="isRunning(exam.id)" class="size-3 animate-spin" />
          <Play v-else class="size-3" />
          {{ isRunning(exam.id) ? "答题中" : "开始" }}
        </button>
      </div>
    </div>

    <div v-if="liveLogs.length" class="mt-3 rounded-lg border border-border bg-muted/30 p-2.5">
      <div class="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
        <span>实时过程</span>
        <span v-if="progress" class="mono">{{ progress.current }}/{{ progress.total }}</span>
      </div>
      <div v-if="progress" class="mb-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.round((progress.current / progress.total) * 100)}%` }" />
      </div>
      <div class="space-y-0.5">
        <p
          v-for="(l, i) in liveLogs.slice(-10)"
          :key="i"
          class="mono text-[12px] leading-4"
          :class="{ 'text-amber-500': l.level === 'warn', 'text-red-500': l.level === 'error' }"
        >{{ l.message }}</p>
      </div>
    </div>
  </div>
</template>
