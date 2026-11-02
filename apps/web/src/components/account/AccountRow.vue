<script setup lang="ts">
import { computed } from "vue";
import type { JobEvent, JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { Checkbox } from "@/components/ui/checkbox";
import ProgressRing from "@/components/charts/ProgressRing.vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  account: AccountWithSession;
  platformName: string;
  job?: JobVO | null;
  progress?: JobEvent | null;
  schedule?: ScheduleVO | null;
  selected: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  open: [];
  start: [];
  stop: [];
}>();

const running = computed(() => props.job?.state === "running");
const online = computed(() => props.account.hasSession && props.account.sessionState !== "error");
const loginFailed = computed(() => props.account.lastVerifyOk === 0);

const status = computed(() => {
  if (loginFailed.value) return { text: "登录失效", tone: "coral" as const };
  if (online.value) return { text: "在线", tone: "mint" as const };
  return { text: "待登录", tone: "muted" as const };
});

const phase = computed(() => {
  const p = props.progress?.phase;
  const map = { login: "登录", video: "视频", work: "作业", exam: "考试" } as const;
  if (p) return map[p];
  return running.value ? "准备" : "待机";
});

const stageTone = computed(() => {
  switch (props.progress?.phase) {
    case "work":
      return "amber" as const;
    case "exam":
      return "ice" as const;
    case "video":
      return "mint" as const;
    default:
      return props.job?.state === "running" ? "mint" as const : "muted" as const;
  }
});

const ringTone = computed(() => {
  if (props.job?.state === "error") return "coral" as const;
  if (props.job?.state === "stopped") return "muted" as const;
  return stageTone.value;
});

const courseName = computed(() => props.progress?.courseName ?? "");
const nodeName = computed(() => props.progress?.nodeName ?? "");
const percent = computed(() => {
  const p = props.progress?.progress;
  if (typeof p === "number") return Math.min(100, Math.max(0, p));
  return props.job?.state === "done" ? 100 : 0;
});

const watched = computed(() => {
  const s = props.progress?.watchedSeconds;
  const t = props.progress?.totalSeconds;
  if (s === undefined) return "";
  return `${formatDuration(s)}${t ? ` / ${formatDuration(t)}` : ""}`;
});

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const scheduleText = computed(() => {
  const s = props.schedule;
  if (!s) return null;
  const parts = s.cron.trim().split(/\s+/);
  const time =
    parts.length >= 2
      ? `${parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}`
      : s.cron;
  return { name: s.name || "定时规则", time: s.endTime ? `${time} → ${s.endTime}` : time };
});

const subtitle = computed(() => props.account.remark || props.account.username);
const jobLabel = computed(() => {
  if (!props.job) return "";
  return { running: "运行中", done: "已完成", stopped: "已停止", error: "出错" }[props.job.state];
});
</script>

<template>
  <div
    :class="cn(
      'group relative grid min-w-[980px] items-center gap-3 border-b border-border/70 px-4 py-3 transition-colors last:border-b-0',
      'grid-cols-[20px_minmax(168px,1.05fr)_82px_minmax(0,1.65fr)_132px_116px_92px]',
      selected ? 'bg-primary/5' : 'hover:bg-accent/30',
    )"
  >
    <span v-if="selected" class="absolute inset-y-0 left-0 w-px bg-primary" />
    <Checkbox :model-value="selected" @update:model-value="emit('toggle')" />

    <div class="flex min-w-0 items-center gap-2.5">
      <div
        :class="cn(
          'grid size-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold',
          selected
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-panel-2 text-muted-foreground',
        )"
      >
        {{ (account.remark || account.username).slice(0, 1) }}
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[12.5px] font-medium">{{ subtitle }}</span>
          <span class="mono rounded border border-border px-1 py-px text-[8px] uppercase text-muted-foreground">{{ platformName }}</span>
        </div>
        <div class="mono mt-0.5 truncate text-[9.5px] text-muted-foreground">{{ account.username }}</div>
      </div>
    </div>

    <div class="flex items-center gap-1.5 text-[10.5px]">
      <span
        :class="cn(
          'size-1.5 rounded-full',
          status.tone === 'mint' && 'bg-mint',
          status.tone === 'coral' && 'bg-coral',
          status.tone === 'muted' && 'bg-muted-foreground/50',
          running && 'animate-breathe',
        )"
      />
      <span :class="status.tone === 'coral' ? 'text-coral' : 'text-muted-foreground'">{{ status.text }}</span>
    </div>

    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span
          :class="cn(
            'stage-chip shrink-0',
            stageTone === 'mint' && 'border-mint/30 bg-mint/10 text-mint',
            stageTone === 'amber' && 'border-amber/30 bg-amber/10 text-amber',
            stageTone === 'ice' && 'border-ice/30 bg-ice/10 text-ice',
            stageTone === 'muted' && 'text-muted-foreground',
          )"
        >{{ phase }}</span>
        <span class="min-w-0 truncate text-[11.5px]">
          <template v-if="running">{{ courseName || "正在建立会话" }}<span v-if="nodeName" class="text-muted-foreground"> · {{ nodeName }}</span></template>
          <template v-else-if="job"><span class="text-muted-foreground">上次任务：{{ jobLabel }}</span></template>
          <template v-else><span class="text-muted-foreground">— 未启动</span></template>
        </span>
      </div>
      <div class="mono mt-1 truncate text-[9px] text-muted-foreground">
        <template v-if="watched">{{ watched }}</template>
        <template v-else-if="job?.summary">视频 {{ job.summary.videosCompleted }} · 作业 {{ job.summary.worksDone }} · 考试 {{ job.summary.examsDone }}</template>
        <template v-else>{{ account.enabled ? "READY" : "DISABLED" }}</template>
      </div>
    </div>

    <div class="flex items-center gap-2.5">
      <ProgressRing :value="percent" :size="38" :stroke="3.5" :tone="ringTone" />
      <div class="min-w-0 flex-1">
        <div class="mono flex items-baseline justify-between text-[9.5px] text-muted-foreground">
          <span>{{ running ? "LIVE" : job ? jobLabel : "IDLE" }}</span>
          <span>{{ Math.round(percent) }}%</span>
        </div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            :class="cn(
              'h-full rounded-full transition-[width] duration-500',
              ringTone === 'amber' && 'bg-amber',
              ringTone === 'coral' && 'bg-coral',
              ringTone === 'muted' && 'bg-muted-foreground/40',
              (ringTone === 'mint' || ringTone === 'ice') && 'bg-mint',
            )"
            :style="{ width: `${percent}%` }"
          />
        </div>
      </div>
    </div>

    <div class="text-[10px] leading-4">
      <template v-if="scheduleText">
        <div class="mono truncate text-foreground/80">{{ scheduleText.time }}</div>
        <div class="truncate text-[9px] text-muted-foreground">{{ scheduleText.name }}</div>
      </template>
      <span v-else class="mono text-[9px] text-muted-foreground">— NO SCHEDULE</span>
    </div>

    <div class="flex items-center justify-end gap-0.5">
      <button
        v-if="running"
        class="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-coral/40 hover:text-coral"
        @click="emit('stop')"
      >停止</button>
      <button
        v-else
        class="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        @click="emit('start')"
      >启动</button>
      <button
        class="rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="emit('open')"
      >详情</button>
    </div>
  </div>
</template>
