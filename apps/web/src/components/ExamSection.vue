<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { ClipboardList, Play } from "lucide-vue-next";
import { computed, ref } from "vue";
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
 * 三态结果语义与任务运行器一致：得分 / 已提交未确认 / 仅答题未提交。
 */
const props = defineProps<{
  accountUid: string;
  courseId: string;
}>();

const events = useEventStore();
const gatewayOffline = computed(() => events.gatewayStatus !== null && !events.gatewayStatus.up);

const examsQuery = useQuery({
  queryKey: computed(() => ["exams", props.accountUid, props.courseId]),
  queryFn: () => api.exams(props.accountUid, props.courseId),
  staleTime: 60_000,
});

// 答题源在区块级选择，逐场复用；默认不提交（可先答题后到平台核对）
const source = ref<"off" | "ai" | "bank">("ai");
const sourceOptions = [
  { value: "off", label: "仅拉取题目，不答题" },
  { value: "ai", label: "AI 答题（需在全局设置配置）" },
  { value: "bank", label: "外置题库（需在全局设置配置）" },
];

const doExamMutation = useMutation({
  mutationFn: (exam: ExamDTO) =>
    api.doExam(props.accountUid, props.courseId, {
      examId: exam.id,
      source: source.value,
      submit: true,
    }),
  onSuccess: (r) => {
    if (r.submitted && r.score > 0) toast.success(`考试完成：${r.title}（得分 ${r.score}）`);
    else if (r.submitted) toast.warning(`已提交但未确认得分，请到平台核实：${r.title}`);
    else toast.info(`已答题，未提交：${r.title}`);
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
          :disabled="doExamMutation.isPending.value || gatewayOffline"
          :title="gatewayOffline ? '网关离线——请先修复网关' : undefined"
          @click="doExamMutation.mutate(exam)"
        >
          <Play class="size-3" />
          {{ doExamMutation.isPending.value ? "进行中…" : "开始" }}
        </Button>
      </div>
    </div>
    <p class="mt-2.5 text-xs text-muted-foreground">
      单场考试为同步操作：答题过程在网关完成，结束后按得分/未确认/未提交三态提示
    </p>
  </div>
</template>
