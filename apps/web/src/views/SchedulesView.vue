<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import type { ScheduleVO } from "@yatori/shared";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import ScheduleDialog from "@/components/account/ScheduleDialog.vue";
import { relativeTime } from "@/lib/utils";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
import { isPending, runPending } from "@/lib/pending";

const queryClient = useQueryClient();
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts() });
const schedulesQuery = useQuery({
  queryKey: ["schedules"],
  queryFn: () => api.schedules({ silent: true }),
  refetchInterval: 30_000,
});
const dialogOpen = ref(false);
/** 编辑目标：null = 新建模式 */
const editing = ref<ScheduleVO | null>(null);

function openCreate() {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(s: ScheduleVO) {
  editing.value = s;
  dialogOpen.value = true;
}

const accounts = computed(() => accountsQuery.data.value ?? []);
const accountOptions = computed(() =>
  accounts.value.map((a) => ({ uid: a.uid, label: a.remark || a.username })),
);

function accountLabel(uid: string): string {
  const a = accounts.value.find((x) => x.uid === uid);
  return a ? a.remark || a.username : uid.slice(0, 8);
}

/** 作用范围展示文案：全部账号 / 账号名单（空名单显示警示文案） */
function scopeLabel(s: ScheduleVO): string {
  if (s.scope === "all") return "全部账号";
  if (s.accountUids.length === 0) return "未指定账号";
  return s.accountUids.map(accountLabel).join("、");
}

const WEEK_TEXT: Record<string, string> = {
  "*": "每天",
  "0,1,2,3,4,5,6": "每天",
  "1,2,3,4,5": "工作日",
  "1-5": "工作日",
  "0,6": "周末",
  "6,0": "周末",
};

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function startMinutes(s: ScheduleVO): number {
  const parts = s.cron.trim().split(/\s+/);
  return (Number(parts[1] ?? 0) * 60 + Number(parts[0] ?? 0)) || 0;
}

function timeOf(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return cron;
  const pad = (v: string) => (v === "*" ? "?" : v.padStart(2, "0"));
  return `${pad(parts[1]!)}:${pad(parts[0]!)}`;
}

function daysOf(cron: string): string {
  const dow = cron.trim().split(/\s+/)[4] ?? "*";
  if (WEEK_TEXT[dow]) return WEEK_TEXT[dow]!;
  if (/^\d(,\d)+$/.test(dow)) return `周 ${dow.split(",").join("、")}`;
  if (/^\d-\d$/.test(dow)) return `周 ${dow.replace("-", " 至 ")}`;
  return dow === "*" ? "每天" : dow;
}

function summary(s: ScheduleVO): string {
  return s.endTime
    ? `${daysOf(s.cron)} ${timeOf(s.cron)} → ${s.endTime}`
    : `${daysOf(s.cron)} ${timeOf(s.cron)} 开始`;
}

function barStyle(s: ScheduleVO): { left: string; width: string } {
  const start = startMinutes(s);
  const end = s.endTime ? minutesOf(s.endTime) : start + 30;
  const span = end > start ? end - start : 1440 - start;
  return {
    left: `${(start / 1440) * 100}%`,
    width: `${Math.max(0.8, (span / 1440) * 100)}%`,
  };
}

const activeCount = computed(() => (schedulesQuery.data.value ?? []).filter((s) => s.enabled).length);

const toggleMutation = useMutation({
  mutationFn: (id: string) => api.toggleSchedule(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  onError: (err) => toastError(err, "切换规则失败"),
});
const deleteMutation = useMutation({
  mutationFn: (id: string) => api.deleteSchedule(id),
  onSuccess: () => {
    toast.success("定时规则已删除");
    void queryClient.invalidateQueries({ queryKey: ["schedules"] });
  },
  onError: (err) => toastError(err, "删除规则失败"),
});

function ruleName(s: ScheduleVO): string {
  return s.name || "未命名规则";
}

async function askToggle(s: ScheduleVO) {
  if (isPending(`toggle:${s.id}`)) return;
  // 只在关闭（暂停）规则时确认，启用是恢复性操作无需拦截
  if (s.enabled) {
    const ok = await confirmAction({
      title: `暂停定时规则「${ruleName(s)}」？`,
      description: "暂停后到点不再自动开始任务，已启动的任务不受影响，随时可以重新启用。",
      confirmText: "暂停规则",
    });
    if (!ok) return;
  }
  runPending(`toggle:${s.id}`, () => toggleMutation.mutateAsync(s.id));
}

async function askDelete(s: ScheduleVO) {
  if (isPending(`delete:${s.id}`)) return;
  const ok = await confirmAction({
    title: `删除定时规则「${ruleName(s)}」？`,
    description: "删除后规则不再自动开始或停止任务，该操作不可撤销。",
    confirmText: "删除规则",
    tone: "danger",
  });
  if (ok) runPending(`delete:${s.id}`, () => deleteMutation.mutateAsync(s.id));
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">定时</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">
          一条规则绑定多个账号，到点自动开始，到点自动停止
        </p>
      </div>
      <Button size="sm" class="ml-auto h-8 gap-1.5 text-[13.5px]" @click="openCreate">
        <Plus class="size-3.5" />新建规则
      </Button>
    </header>

    <div v-if="schedulesQuery.isLoading.value" class="panel space-y-2 p-4">
      <Skeleton v-for="i in 4" :key="i" class="h-14 w-full" />
    </div>

    <div v-else-if="!(schedulesQuery.data.value ?? []).length" class="panel px-6 py-16 text-center">
      <div class="mx-auto grid size-12 place-items-center rounded-2xl border border-border bg-panel-2 text-primary">
        <AlarmClock class="size-5" />
      </div>
      <h2 class="mt-4 text-[16px] font-semibold">还没有定时规则</h2>
      <p class="mt-1 text-[14px] text-muted-foreground">例如工作日 20:30 开始刷课，22:30 自动停止</p>
      <Button class="mt-4" @click="openCreate"><Plus class="size-4" />新建规则</Button>
    </div>

    <template v-else>
      <!-- 24 小时排程 -->
      <section class="panel px-4 py-3.5">
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="text-[15px] font-medium">今日排程</h2>
          <span class="mono ml-auto text-[12px] text-muted-foreground">{{ activeCount }} 条生效 / {{ schedulesQuery.data.value?.length ?? 0 }}</span>
        </div>

        <div class="mt-3 grid grid-cols-[132px_minmax(0,1fr)] gap-3">
          <div />
          <div class="relative">
            <div class="flex justify-between border-b border-border pb-1">
              <span v-for="h in [0, 6, 12, 18, 24]" :key="h" class="mono text-[11px] text-muted-foreground">
                {{ String(h).padStart(2, "0") }}:00
              </span>
            </div>
          </div>

          <template v-for="s in schedulesQuery.data.value" :key="s.id">
            <div class="min-w-0 self-center">
              <div class="truncate text-[13.5px]">{{ s.name || "未命名规则" }}</div>
              <div class="mono truncate text-[12px] text-muted-foreground">
                {{ s.scope === "all" ? "全部账号" : `${s.accountUids.length} 个账号` }} · {{ daysOf(s.cron) }}
              </div>
            </div>
            <div class="relative my-1 h-6 rounded-md border border-border/60 bg-panel-2/60">
              <div
                class="absolute inset-y-1 rounded bg-mint/25"
                :class="s.enabled ? 'border border-mint/40' : 'opacity-40'"
                :style="barStyle(s)"
              >
                <div class="absolute inset-y-0 left-0 w-px bg-mint" />
                <span class="mono absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-mint">
                  {{ timeOf(s.cron) }}<template v-if="s.endTime"> → {{ s.endTime }}</template>
                </span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- 规则列表 -->
      <div class="grid gap-2">
        <div
          v-for="s in schedulesQuery.data.value"
          :key="s.id"
          class="panel flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <div class="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-panel-2 text-primary">
            <AlarmClock class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-[15px] font-medium">{{ s.name || "未命名规则" }}</span>
              <span
                :class="s.enabled
                  ? 'mono rounded-full border border-mint/30 bg-mint/10 px-1.5 py-0.5 text-[11px] text-mint'
                  : 'mono rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground'"
              >{{ s.enabled ? "启用" : "暂停" }}</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <span class="mono text-foreground/80">{{ summary(s) }}</span>
              <span class="text-border">/</span>
              <span>{{ scopeLabel(s) }}</span>
              <span
                v-if="s.scope === 'accounts' && s.accountUids.length === 0"
                class="mono rounded-full border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] text-amber"
              >作用域为空，到点跳过</span>
              <span class="text-border">/</span>
              <span>{{ { 1: "普通", 2: "暴力", 3: "去红" }[s.videoMode] }} · {{ { off: "不答题", ai: "AI", bank: "题库" }[s.answerSource] }}</span>
              <template v-if="s.lastRunAt">
                <span class="text-border">/</span><span>上次 {{ relativeTime(s.lastRunAt) }}</span>
              </template>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Switch :model-value="s.enabled" :disabled="isPending(`toggle:${s.id}`) || isPending(`delete:${s.id}`)" @update:model-value="askToggle(s)" />
            <Button
              variant="ghost"
              size="icon"
              class="size-7 text-muted-foreground hover:text-foreground"
              :disabled="isPending(`delete:${s.id}`) || isPending(`toggle:${s.id}`)"
              @click="openEdit(s)"
            ><Pencil class="size-3.5" /></Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-7 text-muted-foreground hover:text-coral"
              :disabled="isPending(`delete:${s.id}`) || isPending(`toggle:${s.id}`)"
              @click="askDelete(s)"
            ><Trash2 class="size-3.5" /></Button>
          </div>
        </div>
      </div>
    </template>

    <ScheduleDialog
      v-model:open="dialogOpen"
      :accounts="accountOptions"
      :schedule="editing"
      @saved="queryClient.invalidateQueries({ queryKey: ['schedules'] })"
    />
  </div>
</template>
