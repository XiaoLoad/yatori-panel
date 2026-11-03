<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const props = defineProps<{
  open: boolean;
  accounts: { uid: string; label: string }[];
}>();
const emit = defineEmits<{ "update:open": [boolean]; started: [] }>();

const queryClient = useQueryClient();
const single = computed(() => props.accounts.length === 1);
const scope = ref<"all" | "pick">("all");
const selected = ref<string[]>([]);

const videoModeModel = ref("1");
const answerSource = ref<"off" | "ai" | "bank">("off");
const submitMode = ref<"off" | "direct" | "smart">("off");
const concurrency = ref(4);

const coursesQuery = useQuery({
  queryKey: computed(() => ["start-courses", props.accounts[0]?.uid]),
  queryFn: () => api.courses(props.accounts[0]!.uid),
  enabled: computed(() => props.open && single.value),
  staleTime: 30_000,
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    scope.value = "all";
    selected.value = [];
    videoModeModel.value = "1";
    answerSource.value = "off";
    submitMode.value = "off";
    concurrency.value = 4;
  },
);

function toggleCourse(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}

const startMutation = useMutation({
  mutationFn: async () => {
    const courseIds = scope.value === "pick" ? selected.value : [];
    const options = {
      videoMode: Number(videoModeModel.value) as 1 | 2 | 3,
      answerSource: answerSource.value,
      submitMode: submitMode.value,
      perCourseConcurrency: concurrency.value,
    };
    if (single.value) {
      return api.startJob({ accountUid: props.accounts[0]!.uid, courseIds, ...options });
    }
    return api.startJobsBatch({
      accounts: props.accounts.map((a) => ({ accountUid: a.uid, courseIds: scope.value === "pick" ? courseIds : [] })),
      ...options,
    });
  },
  onSuccess: (result) => {
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    emit("update:open", false);
    emit("started");
    if (props.accounts.length === 1) {
      toast.success("任务已启动，进度会实时显示在列表中");
      return;
    }
    const batch = result as { started: unknown[]; failed: { error: string }[] };
    if (batch.failed.length === 0) {
      toast.success(`已为 ${batch.started.length} 个账号启动任务`);
    } else {
      toast.warning(`启动 ${batch.started.length} 个，失败 ${batch.failed.length} 个：${batch.failed[0]!.error}`);
    }
  },
  onError: (err) => toastError(err, "启动任务失败"),
});

function submit() {
  if (scope.value === "pick" && single.value && selected.value.length === 0) {
    toast.error("请至少选择一门课程");
    return;
  }
  startMutation.mutate();
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogHeader>
      <DialogTitle>发起任务</DialogTitle>
      <DialogDescription>
        {{ single ? accounts[0]?.label : `已选 ${accounts.length} 个账号，将同时启动，各自独立运行` }}
      </DialogDescription>
    </DialogHeader>

    <DialogBody class="grid gap-4">
      <div class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[13.5px] text-muted-foreground">
        {{ accounts.map((a) => a.label).join(" · ") }}
      </div>

      <div v-if="single" class="grid gap-1.5">
        <Label>课程范围</Label>
        <div class="flex gap-1 rounded-lg bg-muted p-1">
          <button
            :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', scope === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
            @click="scope = 'all'"
          >全部未完成课程</button>
          <button
            :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', scope === 'pick' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
            @click="scope = 'pick'"
          >手动选择</button>
        </div>
        <div v-if="scope === 'pick'" class="max-h-40 overflow-y-auto rounded-lg border border-border p-1.5">
          <div v-if="coursesQuery.isLoading.value" class="space-y-1.5 p-1">
            <Skeleton v-for="i in 3" :key="i" class="h-5 w-full" />
          </div>
          <p v-else-if="!(coursesQuery.data.value ?? []).length" class="p-2 text-[13.5px] text-muted-foreground">
            该账号下暂无课程（可先到详情里检测登录）
          </p>
          <div
            v-for="course in coursesQuery.data.value ?? []"
            :key="course.id"
            class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40"
          >
            <Checkbox :model-value="selected.includes(course.id)" @update:model-value="toggleCourse(course.id)" />
            <span class="min-w-0 flex-1 truncate text-[14px]">{{ course.name }}</span>
            <span class="mono text-[12px] text-muted-foreground">{{ Math.round(course.progress) }}%</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1.5">
          <Label>刷课模式</Label>
          <Select
            v-model="videoModeModel"
            :options="[
              { value: '1', label: '普通（课程内逐个刷）' },
              { value: '2', label: '暴力（课程内并发 + 自动去红）' },
              { value: '3', label: '去红（只清理标红节点）' },
            ]"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>单课视频并发（仅暴力模式生效）</Label>
          <Input v-model.number="concurrency" type="number" min="1" max="16" />
        </div>
        <div class="grid gap-1.5">
          <Label>答题来源</Label>
          <Select
            v-model="answerSource"
            :options="[
              { value: 'off', label: '不自动答题' },
              { value: 'ai', label: 'AI 答题（需配置）' },
              { value: 'bank', label: '外置题库（需配置）' },
            ]"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>交卷策略</Label>
          <Select
            v-model="submitMode"
            :options="[
              { value: 'off', label: '不交卷（仅保存）' },
              { value: 'smart', label: '智能交卷' },
              { value: 'direct', label: '直接交卷' },
            ]"
          />
        </div>
      </div>

      <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
        <p><span class="text-foreground">普通</span>：一门课里的视频一个一个刷，最稳，耗时约等于视频总时长。</p>
        <p><span class="text-foreground">暴力</span>：一门课里的视频同时上报，速度快，但容易触发平台「并行播放」标记；结束时会自动执行一次去红。</p>
        <p><span class="text-foreground">去红</span>：只处理已经被标记的节点，不刷正常视频，适合事后补救。</p>
        <p class="mt-1">
          作业和考试会在各自节点刷完后立刻处理；同一个账号同时刷几门课，请在
          <span class="text-foreground">设置 → 调度参数 → 单账号课程并发数</span> 里调整。
        </p>
      </div>
    </DialogBody>

    <DialogFooter>
      <Button variant="outline" @click="emit('update:open', false)">取消</Button>
      <Button :disabled="startMutation.isPending.value" @click="submit">
        {{ startMutation.isPending.value ? "启动中…" : `启动 ${accounts.length} 个任务` }}
      </Button>
    </DialogFooter>
  </Dialog>
</template>
