<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { computed, ref } from "vue";
import { toast } from "vue-sonner";
import type { AccountVO, ScheduleVO } from "@yatori/shared";
import { accountDisplayLabel, siteTagsFor } from "@yatori/shared";
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
const allSiteTags = computed(() => siteTagsFor(accounts.value));

/**
 * 作用范围展示文案：全部账号 / 按人聚合的账号名单。
 * 同学号同平台多站点的人：全部选中显示「姓名（全部站点）」，
 * 部分选中逐个显示「姓名 · 站点标签」；空名单显示警示文案。
 */
function scopeLabel(s: ScheduleVO): string {
  if (s.scope === "all") return "全部账号";
  if (s.accountUids.length === 0) return "未指定账号";
  const byPerson = new Map<string, { name: string; total: number; picked: AccountVO[] }>();
  const persons: { name: string; total: number; picked: AccountVO[] }[] = [];
  for (const uid of s.accountUids) {
    const a = accounts.value.find((x) => x.uid === uid);
    if (!a) continue;
    const key = `${a.platform}|${a.username}`;
    let entry = byPerson.get(key);
    if (!entry) {
      const total = accounts.value.filter((x) => x.platform === a.platform && x.username === a.username).length;
      entry = { name: a.remark || a.username, total, picked: [] };
      byPerson.set(key, entry);
      persons.push(entry);
    }
    entry.picked.push(a);
  }
  if (persons.length === 0) return `${s.accountUids.length} 个账号`;
  return persons
    .map((p) => {
      if (p.total > 1 && p.picked.length >= p.total) return `${p.name}（全部站点）`;
      if (p.total > 1) return p.picked.map((a) => accountDisplayLabel(a, allSiteTags.value.get(a.uid))).join("、");
      return p.picked[0] ? p.picked[0].remark || p.picked[0].username : "";
    })
    .filter(Boolean)
    .join("、");
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

/** 时间轴左侧的「什么时候」摘要：一次性规则展示日期，避免被误读成每天 */
function whenLabel(s: ScheduleVO): string {
  return s.repeatMode === "once"
    ? `一次性 · ${s.runDate ? s.runDate.slice(5).replace("-", "/") : "未设日期"}`
    : daysOf(s.cron);
}

function summary(s: ScheduleVO): string {
  // 一次性规则：直接展示执行日期，不再用「周几」描述
  if (s.repeatMode === "once") {
    const date = s.runDate ? s.runDate.slice(5).replace("-", "/") : "未设日期";
    return s.endTime
      ? `${date} ${timeOf(s.cron)} → ${s.endTime}（一次性）`
      : `${date} ${timeOf(s.cron)} 执行一次`;
  }
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

        <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-3">
          <div />
          <div class="relative">
            <div class="flex justify-between border-b border-border pb-1">
              <span v-for="h in [0, 6, 12, 18, 24]" :key="h" class="mono text-[11px] text-muted-foreground">
                {{ String(h).padStart(2, "0") }}:00
              </span>
            </div>
          </div>

          <template v-for="s in schedulesQuery.data.value" :key="s.id">
            <div class="self-center text-[13px] leading-tight">
              <div class="truncate">{{ s.name || "未命名规则" }}</div>
              <div class="mono truncate text-[11px] text-muted-foreground sm:hidden">{{ whenLabel(s) }}</div>
            </div>
            <div class="relative my-1 h-6 rounded-md border border-border/60 bg-panel-2/60">
              <div
                class="absolute inset-y-1 rounded bg-mint/25"
                :class="s.enabled ? 'border border-mint/40' : 'opacity-40'"
                :style="barStyle(s)"
              >
                <div class="absolute inset-y-0 left-0 w-px bg-mint" />
                <span class="mono absolute left-1.5 top-1/2 hidden -translate-y-1/2 whitespace-nowrap text-[11px] text-mint sm:inline">
                  {{ timeOf(s.cron) }}<template v-if="s.endTime"> → {{ s.endTime }}</template>
                </span>
                <span class="mono absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-mint sm:hidden">
                  {{ timeOf(s.cron) }}<template v-if="s.endTime">→{{ s.endTime.slice(0, 2) }}:{{ s.endTime.slice(3) }}</template>
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
          class="panel flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3.5 py-3 sm:px-4"
        >
          <div class="grid size-8 shrink-0 place-items-center rounded-xl border border-border bg-panel-2 text-primary sm:size-9">
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
              <span
                v-if="s.repeatMode === 'once' && s.lastRunAt"
                class="mono rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
              >已执行</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <span class="mono text-foreground/80">{{ summary(s) }}</span>
              <span class="text-border">/</span>
              <span>{{ scopeLabel(s) }}</span>
              <span
                v-if="s.scope === 'accounts' && s.accountUids.length === 0"
                class="mono rounded-full border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] text-amber"
              >作用域为空，到点跳过</span>
              <template v-if="s.courseIds.length > 0">
                <span class="text-border">/</span>
                <span>指定 {{ s.courseIds.length }} 门课程</span>
              </template>
              <span class="text-border">/</span>
              <span>{{ { 1: "普通", 2: "暴力", 3: "去红" }[s.videoMode] }} · {{ { off: "不答题", ai: "AI", bank: "题库" }[s.answerSource] }}</span>
              <template v-if="s.lastRunAt">
                <span class="text-border">/</span><span>上次 {{ relativeTime(s.lastRunAt) }}</span>
              </template>
            </div>
          </div>
          <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
            <Switch :model-value="s.enabled" :disabled="isPending(`toggle:${s.id}`) || isPending(`delete:${s.id}`)" @update:model-value="askToggle(s)" />
            <Button
              variant="ghost"
              size="icon"
              class="size-9 text-muted-foreground hover:text-foreground sm:size-7"
              :disabled="isPending(`delete:${s.id}`) || isPending(`toggle:${s.id}`)"
              @click="openEdit(s)"
            ><Pencil class="size-3.5" /></Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-9 text-muted-foreground hover:text-coral sm:size-7"
              :disabled="isPending(`delete:${s.id}`) || isPending(`toggle:${s.id}`)"
              @click="askDelete(s)"
            ><Trash2 class="size-3.5" /></Button>
          </div>
        </div>
      </div>
    </template>

    <ScheduleDialog
      v-model:open="dialogOpen"
      :accounts="accounts"
      :schedule="editing"
      @saved="queryClient.invalidateQueries({ queryKey: ['schedules'] })"
    />
  </div>
</template>
