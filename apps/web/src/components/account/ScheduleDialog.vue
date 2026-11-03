<script setup lang="ts">
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const props = defineProps<{
  open: boolean;
  accounts: { uid: string; label: string }[];
  preselected?: string[];
}>();

const emit = defineEmits<{ "update:open": [boolean]; saved: [] }>();

const queryClient = useQueryClient();
const name = ref("");
const selected = ref<string[]>([]);
const days = ref<number[]>([1, 2, 3, 4, 5]);
const startTime = ref("20:30");
const endTime = ref("22:30");
const stopMode = ref<"finish_current" | "immediate">("finish_current");
const videoModeModel = ref("1");
const answerSource = ref<"off" | "ai" | "bank">("off");
const submitMode = ref<"off" | "direct" | "smart">("off");

const WEEK = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "";
    selected.value = [...(props.preselected ?? [])];
    days.value = [1, 2, 3, 4, 5];
    startTime.value = "20:30";
    endTime.value = "22:30";
    stopMode.value = "finish_current";
    videoModeModel.value = "1";
    answerSource.value = "off";
    submitMode.value = "off";
  },
);

function toggleAccount(uid: string) {
  selected.value = selected.value.includes(uid)
    ? selected.value.filter((x) => x !== uid)
    : [...selected.value, uid];
}

function toggleDay(d: number) {
  days.value = days.value.includes(d)
    ? days.value.filter((x) => x !== d)
    : [...days.value, d];
}

const cron = computed(() => {
  const [h, m] = startTime.value.split(":").map(Number);
  const dow = days.value.length === 7 ? "*" : [...days.value].sort((a, b) => a - b).join(",");
  return `${m ?? 0} ${h ?? 0} * * ${dow || "*"}`;
});

const preview = computed(() => {
  const start = startTime.value;
  return endTime.value ? `每天 ${start} 开始，${endTime.value} 停止` : `每天 ${start} 开始（不自动停止）`;
});

const createMutation = useMutation({
  mutationFn: () =>
    api.createSchedule({
      name: name.value.trim(),
      accountUids: selected.value,
      cron: cron.value,
      endTime: endTime.value || undefined,
      stopMode: stopMode.value,
      videoMode: Number(videoModeModel.value) as 1 | 2 | 3,
      answerSource: answerSource.value,
      submitMode: submitMode.value,
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    toast.success("定时规则已创建，后台常驻生效");
    emit("update:open", false);
    emit("saved");
  },
  onError: (err) => toastError(err, "创建定时规则失败"),
});

function submit() {
  if (selected.value.length === 0) {
    toast.error("请至少选择一个账号");
    return;
  }
  if (days.value.length === 0) {
    toast.error("请至少选择一天");
    return;
  }
  createMutation.mutate();
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogHeader>
      <DialogTitle>新建定时规则</DialogTitle>
      <DialogDescription>一条规则可同时作用于多个账号，到点自动开始与停止</DialogDescription>
    </DialogHeader>

    <DialogBody class="grid gap-4">
      <div class="grid gap-1.5">
        <Label>规则名称</Label>
        <Input v-model="name" placeholder="如：晚间批量刷课（留空则按时间命名）" />
      </div>

      <div class="grid gap-1.5">
        <Label>应用到账号（{{ selected.length }}）</Label>
        <div class="flex flex-wrap gap-1.5 rounded-lg border border-border p-2">
          <button
            v-for="a in accounts"
            :key="a.uid"
            :class="cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-1 text-[13.5px] transition-colors',
              selected.includes(a.uid)
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )"
            @click="toggleAccount(a.uid)"
          >
            <Checkbox :model-value="selected.includes(a.uid)" />
            {{ a.label }}
          </button>
        </div>
      </div>

      <div class="grid gap-1.5">
        <Label>重复</Label>
        <div class="flex gap-1.5">
          <button
            v-for="d in WEEK"
            :key="d.value"
            :class="cn(
              'size-7 rounded-md border text-[13.5px] transition-colors',
              days.includes(d.value)
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )"
            @click="toggleDay(d.value)"
          >{{ d.label }}</button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1.5">
          <Label>开始时间</Label>
          <Input v-model="startTime" type="time" />
        </div>
        <div class="grid gap-1.5">
          <Label>结束时间（留空则不停止）</Label>
          <Input v-model="endTime" type="time" />
        </div>
      </div>

      <div class="grid gap-1.5">
        <Label>到点停止行为</Label>
        <div class="flex gap-1 rounded-lg bg-muted p-1">
          <button
            :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', stopMode === 'finish_current' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
            @click="stopMode = 'finish_current'"
          >看完当前节点再停</button>
          <button
            :class="cn('flex-1 rounded-md px-2 py-1.5 text-[13.5px] transition-colors', stopMode === 'immediate' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')"
            @click="stopMode = 'immediate'"
          >立即停止</button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2">
        <div class="grid gap-1.5">
          <Label>模式</Label>
          <Select
            v-model="videoModeModel"
            :options="[{ value: '1', label: '普通' }, { value: '2', label: '暴力+去红' }, { value: '3', label: '仅去红' }]"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>答题</Label>
          <Select
            v-model="answerSource"
            :options="[{ value: 'off', label: '不答题' }, { value: 'ai', label: 'AI' }, { value: 'bank', label: '题库' }]"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>交卷</Label>
          <Select
            v-model="submitMode"
            :options="[{ value: 'off', label: '不交卷' }, { value: 'smart', label: '智能' }, { value: 'direct', label: '直接' }]"
          />
        </div>
      </div>

      <div class="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
        {{ preview }} · cron <code class="mono rounded bg-muted px-1">{{ cron }}</code>
      </div>

      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        普通 = 课内视频逐个刷；暴力+去红 = 课内并发刷完后自动清理标红节点；仅去红 = 只做补救不刷课。
        作业/考试随节点触发；同一账号同时刷几门课由“设置 → 单账号课程并发数”统一控制。
      </p>
    </DialogBody>

    <DialogFooter>
      <Button variant="outline" @click="emit('update:open', false)">取消</Button>
      <Button :disabled="createMutation.isPending.value" @click="submit">
        {{ createMutation.isPending.value ? "创建中…" : "创建规则" }}
      </Button>
    </DialogFooter>
  </Dialog>
</template>
