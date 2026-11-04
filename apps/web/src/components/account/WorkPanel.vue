<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Loader2, Play } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import type { WorkDTO } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
import { useWorkStatus } from "@/composables/useWorkStatus";

const props = defineProps<{ accountUid: string; courseId: string; platform?: string }>();

const events = useEventStore();
const queryClient = useQueryClient();
const gatewayOffline = computed(() => events.gatewayStatus !== null && !events.gatewayStatus.up);

// 作业状态只读查询：仅英华，展示已提交作业的得分（不消耗做题次数）
const { worksQuery, resultsQuery, byWork } = useWorkStatus({
  accountUid: () => props.accountUid,
  courseId: () => props.courseId,
  platform: () => props.platform,
});

const runningQuery = useQuery({
  queryKey: computed(() => ["drawer-works-running", props.accountUid]),
  queryFn: () => api.runningWorks(props.accountUid, { silent: true }),
  // 任务状态变化由 SSE 失效刷新，此间隔仅作断线兜底
  refetchInterval: 30_000,
});

const source = ref<"off" | "ai" | "bank">("bank");
const submitMode = ref<"on" | "off">("on");

const sourceOptions = [
  { value: "off", label: "仅拉取题目，不答题" },
  { value: "ai", label: "AI 答题（需在全局设置配置）" },
  { value: "bank", label: "外置题库（需在全局设置配置）" },
];
const submitOptions = [
  { value: "on", label: "答完自动提交" },
  { value: "off", label: "仅保存草稿，不提交" },
];

// ---------- 选择与批量 ----------
const selected = ref<Set<string>>(new Set());
const works = computed(() => worksQuery.data.value ?? []);
const selectableWorks = computed(() => works.value.filter((w) => !isRunning(w.id)));
const allSelected = computed(
  () => selectableWorks.value.length > 0 && selectableWorks.value.every((w) => selected.value.has(w.id)),
);
function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(selectableWorks.value.map((w) => w.id));
  }
}
function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

const liveLogs = ref<{ level: string; message: string }[]>([]);

watch(
  () => events.logs.length,
  () => {
    const last = events.logs[events.logs.length - 1];
    if (!last || last.accountId !== props.accountUid) return;
    if (!last.message?.startsWith("[单场作业]")) return;
    const message = last.message.replace("[单场作业] ", "");
    liveLogs.value.push({ level: last.level ?? "info", message });
    if (liveLogs.value.length > 40) liveLogs.value.shift();
    if (/批量任务结束|批量任务异常终止/.test(message)) {
      void queryClient.invalidateQueries({ queryKey: ["drawer-works-running", props.accountUid] });
      void queryClient.invalidateQueries({ queryKey: ["drawer-works", props.accountUid, props.courseId] });
      void queryClient.invalidateQueries({ queryKey: ["work-results", props.accountUid, props.courseId] });
    }
  },
);

function isRunning(workId: string): boolean {
  return (runningQuery.data.value ?? []).some((r) => r.workId === workId);
}

const doWorkMutation = useMutation({
  mutationFn: (targets: WorkDTO[]) =>
    api.doWork(props.accountUid, props.courseId, {
      works: targets.map((w) => ({ workId: w.id, workName: w.name })),
      source: source.value,
      submit: submitMode.value === "on",
    }),
  onSuccess: (r) => {
    toast.info(r.count > 1 ? `已开始批量处理 ${r.count} 份作业，过程可在实时日志查看` : "已开始处理作业，过程可在实时日志查看");
    selected.value = new Set();
    void queryClient.invalidateQueries({ queryKey: ["drawer-works-running", props.accountUid] });
  },
  onError: (err) => toastError(err, "作业触发失败"),
});

async function startWorks(targets: WorkDTO[]) {
  if (!targets.length) return;
  const desc =
    targets.length > 1
      ? `将依次完成 ${targets.length} 份作业，未选提交模式为「${submitMode.value === "on" ? "答完自动提交" : "仅保存草稿"}」。`
      : `将完成作业「${targets[0].name}」，提交模式为「${submitMode.value === "on" ? "答完自动提交" : "仅保存草稿"}」。`;
  const ok = await confirmAction({
    title: targets.length > 1 ? `批量完成 ${targets.length} 份作业？` : "开始完成该作业？",
    description: desc,
    confirmText: "开始",
  });
  if (ok) doWorkMutation.mutate(targets);
}

/** 英华：只读查询已提交作业的得分（详情页正则提取，未提交/成绩未出明确区分） */
function resultOf(work: WorkDTO): { text: string; tone: string } | null {
  if (props.platform !== "YINGHUA") return null;
  const r = byWork.value[work.id];
  if (!r) return null;
  if (r.error) return { text: "状态查询失败", tone: "text-coral" };
  if (r.taken && typeof r.score === "number") return { text: `已提交 · ${r.score} 分`, tone: "text-mint" };
  if (r.taken) return { text: "已提交 · 成绩未出", tone: "text-amber" };
  return { text: "未提交", tone: "text-muted-foreground" };
}

function scoreFullOf(work: WorkDTO): string {
  if (props.platform !== "YINGHUA") return "";
  const score = work.extra?.score;
  return score ? `满分 ${score}` : "";
}

function statusText(work: WorkDTO): { text: string; tone: string } | null {
  const s = (work.status || "").toLowerCase();
  if (!s) return null;
  if (s.includes("done") || s.includes("finish") || s.includes("complete") || s.includes("submitted")) {
    return { text: "已完成", tone: "text-mint" };
  }
  if (s.includes("redo") || s.includes("重做")) {
    return { text: "待重做", tone: "text-amber" };
  }
  if (s.includes("ing") || s.includes("open") || s.includes("start")) {
    return { text: "进行中", tone: "text-amber" };
  }
  return { text: work.status, tone: "text-muted-foreground" };
}

function deadlineText(work: WorkDTO): string {
  if (!work.deadline) return "";
  const t = Date.parse(work.deadline);
  if (!Number.isFinite(t)) return "";
  return `截止 ${new Date(t).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`;
}
</script>

<template>
  <div class="p-3.5">
    <div class="mb-2 grid gap-1.5">
      <Select v-model="source" :options="sourceOptions" />
      <Select v-model="submitMode" :options="submitOptions" />
    </div>

    <div v-if="!courseId" class="py-8 text-center text-[13.5px] text-muted-foreground">
      先从课程标签选择一门课程
    </div>
    <div v-else-if="worksQuery.isLoading.value" class="space-y-1.5">
      <Skeleton v-for="i in 3" :key="i" class="h-8 w-full" />
    </div>
    <p v-else-if="!works.length" class="py-8 text-center text-[13.5px] text-muted-foreground">
      该课程暂无作业
    </p>
    <template v-else>
      <div class="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
        <label class="flex cursor-pointer items-center gap-1.5 select-none">
          <input
            type="checkbox"
            class="size-3.5 accent-[var(--primary)]"
            :checked="allSelected"
            @change="toggleAll"
          />
          全选
        </label>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2.5 text-[12.5px]"
          :disabled="!selected.size || doWorkMutation.isPending.value || gatewayOffline"
          @click="startWorks(works.filter((w) => selected.has(w.id)))"
        >
          批量完成{{ selected.size ? `（${selected.size}）` : "" }}
        </Button>
      </div>

      <div class="space-y-1.5">
        <div
          v-for="work in works"
          :key="work.id"
          class="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
        >
          <input
            type="checkbox"
            class="size-3.5 shrink-0 accent-[var(--primary)]"
            :checked="selected.has(work.id)"
            :disabled="isRunning(work.id)"
            @change="toggle(work.id)"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-[14px]">{{ work.name }}</div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span v-if="work.questionCount">{{ work.questionCount }} 题</span>
              <span v-if="scoreFullOf(work)" class="mono">{{ scoreFullOf(work) }}</span>
              <span v-if="deadlineText(work)" class="mono">{{ deadlineText(work) }}</span>
              <span v-if="statusText(work)" class="mono" :class="statusText(work)?.tone">{{ statusText(work)?.text }}</span>
              <span
                v-if="resultOf(work)"
                class="mono"
                :class="resultOf(work)?.tone"
                :title="byWork[work.id]?.message"
              >{{ resultOf(work)?.text }}</span>
              <span v-else-if="platform === 'YINGHUA' && resultsQuery.isLoading.value" class="text-primary/80">状态查询中…</span>
            </div>
          </div>
          <button
            class="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            :disabled="doWorkMutation.isPending.value || gatewayOffline || isRunning(work.id)"
            @click="startWorks([work])"
          >
            <Loader2 v-if="isRunning(work.id)" class="size-3 animate-spin" />
            <Play v-else class="size-3" />
            {{ isRunning(work.id) ? "答题中" : "开始" }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="liveLogs.length" class="mt-3 rounded-lg border border-border bg-muted/30 p-2.5">
      <div class="mb-1 text-[12px] text-muted-foreground">实时过程</div>
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
