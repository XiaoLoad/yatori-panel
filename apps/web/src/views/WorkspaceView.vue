<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, Plus, Search, Users, X } from "lucide-vue-next";
import gsap from "gsap";
import { computed, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import type { JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AccountRow from "@/components/account/AccountRow.vue";
import AccountDrawer from "@/components/account/AccountDrawer.vue";
import AddAccountDialog from "@/components/account/AddAccountDialog.vue";
import StartJobDialog from "@/components/account/StartJobDialog.vue";
import ScheduleDialog from "@/components/account/ScheduleDialog.vue";
import DailyTrend from "@/components/charts/DailyTrend.vue";
import StatusDonut from "@/components/charts/StatusDonut.vue";
import Sparkline from "@/components/charts/Sparkline.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const queryClient = useQueryClient();
const events = useEventStore();
const root = ref<HTMLElement | null>(null);

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 80 }),
  refetchInterval: 5_000,
});
const schedulesQuery = useQuery({
  queryKey: ["schedules"],
  queryFn: api.schedules,
  refetchInterval: 30_000,
});
const statsQuery = useQuery({
  queryKey: ["stats", 14],
  queryFn: () => api.statsDaily(14),
  refetchInterval: 60_000,
});

// ---------- 索引 ----------
const runningByAccount = computed<Record<string, JobVO>>(() => {
  const map: Record<string, JobVO> = {};
  for (const j of jobsQuery.data.value ?? []) {
    if (j.state !== "running") continue;
    const prev = map[j.accountUid];
    if (!prev || j.startedAt > prev.startedAt) map[j.accountUid] = j;
  }
  return map;
});

const latestByAccount = computed<Record<string, JobVO>>(() => {
  const map: Record<string, JobVO> = {};
  for (const j of jobsQuery.data.value ?? []) {
    if (!map[j.accountUid]) map[j.accountUid] = j;
  }
  return map;
});

const scheduleByAccount = computed<Record<string, ScheduleVO>>(() => {
  const map: Record<string, ScheduleVO> = {};
  for (const s of schedulesQuery.data.value ?? []) {
    if (!s.enabled) continue;
    for (const uid of s.accountUids) map[uid] ??= s;
  }
  return map;
});

const platformName = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const p of platformsQuery.data.value ?? []) map[p.key] = p.name;
  return map;
});

// ---------- 筛选 ----------
const platformFilter = ref("all");
const statusFilter = ref<"all" | "running" | "online" | "error">("all");
const search = ref("");

function statusOf(a: AccountWithSession): "running" | "online" | "error" | "idle" {
  if (runningByAccount.value[a.uid]) return "running";
  if (a.lastVerifyOk === 0 || a.sessionState === "error") return "error";
  if (a.hasSession) return "online";
  return "idle";
}

const platformCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const a of accountsQuery.data.value ?? []) counts[a.platform] = (counts[a.platform] ?? 0) + 1;
  return counts;
});

const counts = computed(() => {
  const c = { running: 0, online: 0, error: 0, idle: 0 };
  for (const a of accountsQuery.data.value ?? []) c[statusOf(a)] += 1;
  return c;
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (accountsQuery.data.value ?? []).filter((a) => {
    if (platformFilter.value !== "all" && a.platform !== platformFilter.value) return false;
    if (statusFilter.value !== "all" && statusOf(a) !== statusFilter.value) return false;
    if (!q) return true;
    return [a.remark, a.username, platformName.value[a.platform]].some((v) =>
      (v ?? "").toLowerCase().includes(q),
    );
  });
});

const groups = computed(() => {
  const order = (platformsQuery.data.value ?? []).map((p) => p.key);
  const byPlatform = new Map<string, AccountWithSession[]>();
  for (const a of filtered.value) {
    byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  }
  return [...byPlatform.entries()]
    .sort((x, y) => {
      const ix = order.indexOf(x[0]);
      const iy = order.indexOf(y[0]);
      return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
    })
    .map(([key, items]) => ({ key, name: platformName.value[key] ?? key, items }));
});

// ---------- 指标 ----------
const stats = computed(() => statsQuery.data.value ?? []);
const today = computed(() => stats.value[stats.value.length - 1]);
const yesterday = computed(() => stats.value[stats.value.length - 2]);
const videoSpark = computed(() => stats.value.map((d) => d.videos));
const jobSpark = computed(() => stats.value.map((d) => d.jobs));

const activeSchedules = computed(() => (schedulesQuery.data.value ?? []).filter((s) => s.enabled));

const upcomingSchedules = computed(() => {
  const minutes = (s: ScheduleVO) => {
    const parts = s.cron.trim().split(/\s+/);
    return (Number(parts[1] ?? 0) * 60 + Number(parts[0] ?? 0)) || 0;
  };
  return [...activeSchedules.value].sort((a, b) => minutes(a) - minutes(b)).slice(0, 3);
});

function timeOf(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[1]!.padStart(2, "0")}:${parts[0]!.padStart(2, "0")}` : cron;
}

const videoDelta = computed(() => {
  if (!today.value || !yesterday.value) return null;
  const diff = today.value.videos - yesterday.value.videos;
  if (yesterday.value.videos === 0) return diff > 0 ? "+100%" : "—";
  return `${diff >= 0 ? "+" : ""}${Math.round((diff / yesterday.value.videos) * 100)}%`;
});

// ---------- 批量选择 ----------
const selectedUids = ref<string[]>([]);
const selectedAccounts = computed(() =>
  (accountsQuery.data.value ?? []).filter((a) => selectedUids.value.includes(a.uid)),
);
const selectedPayload = computed(() =>
  selectedAccounts.value.map((a) => ({ uid: a.uid, label: a.remark || a.username })),
);

function toggle(uid: string) {
  selectedUids.value = selectedUids.value.includes(uid)
    ? selectedUids.value.filter((x) => x !== uid)
    : [...selectedUids.value, uid];
}

function toggleGroup(items: AccountWithSession[]) {
  const uids = items.map((a) => a.uid);
  const allIn = uids.every((u) => selectedUids.value.includes(u));
  selectedUids.value = allIn
    ? selectedUids.value.filter((u) => !uids.includes(u))
    : [...new Set([...selectedUids.value, ...uids])];
}

const selectedRunning = computed(() =>
  selectedAccounts.value.map((a) => runningByAccount.value[a.uid]).filter((j): j is JobVO => !!j),
);

// ---------- 弹窗 ----------
const addOpen = ref(false);
const addEditing = ref<AccountWithSession | null>(null);
const startOpen = ref(false);
const scheduleOpen = ref(false);
const schedulePreselect = ref<string[]>([]);
const startPayload = ref<{ uid: string; label: string }[]>([]);

function openAdd(account: AccountWithSession | null = null) {
  addEditing.value = account;
  addOpen.value = true;
}
function openStart(accounts: { uid: string; label: string }[]) {
  startPayload.value = accounts;
  startOpen.value = true;
}
function openSchedule(preselected: string[] = []) {
  schedulePreselect.value = preselected;
  scheduleOpen.value = true;
}

// ---------- 详情抽屉 ----------
const drawerUid = ref<string | null>(null);
const drawerAccount = computed(() =>
  (accountsQuery.data.value ?? []).find((a) => a.uid === drawerUid.value) ?? null,
);
const drawerJob = computed(() =>
  drawerUid.value ? runningByAccount.value[drawerUid.value] ?? null : null,
);
const drawerProgress = computed(() =>
  drawerJob.value ? events.jobLive[drawerJob.value.id]?.lastProgress ?? null : null,
);
const drawerSchedule = computed(() =>
  drawerUid.value ? scheduleByAccount.value[drawerUid.value] ?? null : null,
);

// ---------- 操作 ----------
const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    toast.success(r.stopped ? "已发送停止指令" : r.reason ?? "任务已结束");
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "停止任务失败"),
});

const verifyMutation = useMutation({
  mutationFn: (uid: string) => api.verifyAccount(uid),
  onSuccess: (r) => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    if (r.ok) toast.success(`登录正常，共 ${r.courseCount} 门课程`);
    else toast.warning("登录异常，请检查账号信息");
  },
  onError: (err) => toastError(err, "登录检测失败"),
});

const removeMutation = useMutation({
  mutationFn: (uid: string) => api.deleteAccount(uid),
  onSuccess: () => {
    drawerUid.value = null;
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    toast.success("账号已删除");
  },
  onError: (err) => toastError(err, "删除账号失败"),
});

function stopSelected() {
  for (const job of selectedRunning.value) stopMutation.mutate(job.id);
  if (!selectedRunning.value.length) toast.info("所选账号没有运行中的任务");
}

function askRemove(account: AccountWithSession) {
  if (!window.confirm(`删除账号「${account.remark || account.username}」？该操作不可撤销。`)) return;
  removeMutation.mutate(account.uid);
}

// ---------- 实时活动 ----------
const liveLogs = computed(() => events.logs.slice(-10).reverse());
const accountLabel = (uid?: string) => {
  if (!uid) return "";
  const a = (accountsQuery.data.value ?? []).find((x) => x.uid === uid);
  return a ? a.remark || a.username : uid.slice(0, 6);
};
function clockOf(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

onMounted(() => {
  if (!root.value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.from(root.value.querySelectorAll(".reveal"), {
    y: 14,
    opacity: 0,
    duration: 0.55,
    stagger: 0.05,
    ease: "power2.out",
  });
});
</script>

<template>
  <div ref="root" class="space-y-4">
    <!-- 标题 -->
    <header class="reveal flex flex-wrap items-end gap-3">
      <div>
        <div class="eyebrow">Multi-account / Live telemetry</div>
        <h1 class="display-title mt-1.5 text-[28px] leading-none">观测台</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">
          多账号同步刷课 · 阶段、进度与定时规则在一屏内可见
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="openSchedule()">
          <AlarmClock class="size-3.5" />定时规则
        </Button>
        <Button size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="openAdd()">
          <Plus class="size-3.5" />接入账号
        </Button>
      </div>
    </header>

    <!-- 指标 -->
    <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div class="panel reveal relative overflow-hidden px-4 py-3.5">
        <div class="eyebrow">Running now</div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="mono text-[28px] font-semibold leading-none text-primary">{{ counts.running }}</span>
          <span class="mono text-[12.5px] text-muted-foreground">/ {{ accountsQuery.data.value?.length ?? 0 }} 账号</span>
        </div>
        <div class="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span class="size-1.5 animate-breathe rounded-full bg-primary" />
          在线 {{ counts.online }} · 异常 {{ counts.error }}
        </div>
      </div>

      <div class="panel reveal px-4 py-3.5">
        <div class="flex items-start justify-between">
          <div class="eyebrow">Videos today</div>
          <span class="mono text-[11.5px] text-muted-foreground">{{ videoDelta ?? "—" }}</span>
        </div>
        <div class="mt-2 flex items-baseline gap-1.5">
          <span class="mono text-[28px] font-semibold leading-none">{{ today?.videos ?? 0 }}</span>
          <span class="mono text-[12.5px] text-muted-foreground">段</span>
        </div>
        <Sparkline :values="videoSpark" color="var(--mint)" :height="24" class="mt-2" />
      </div>

      <div class="panel reveal px-4 py-3.5">
        <div class="flex items-start justify-between">
          <div class="eyebrow">Jobs today</div>
          <span class="mono text-[11.5px]" :class="(today?.errors ?? 0) > 0 ? 'text-coral' : 'text-muted-foreground'">
            错误 {{ today?.errors ?? 0 }}
          </span>
        </div>
        <div class="mt-2 flex items-baseline gap-1.5">
          <span class="mono text-[28px] font-semibold leading-none">{{ today?.jobs ?? 0 }}</span>
          <span class="mono text-[12.5px] text-muted-foreground">任务</span>
        </div>
        <Sparkline :values="jobSpark" color="var(--amber)" :height="24" class="mt-2" />
      </div>

      <div class="panel reveal px-4 py-3.5">
        <div class="eyebrow">Schedules</div>
        <div class="mt-2 flex items-baseline gap-1.5">
          <span class="mono text-[28px] font-semibold leading-none">{{ activeSchedules.length }}</span>
          <span class="mono text-[12.5px] text-muted-foreground">条生效</span>
        </div>
        <div class="mono mt-2 truncate text-[12px] text-muted-foreground">
          <template v-if="upcomingSchedules.length">
            下一班次 {{ timeOf(upcomingSchedules[0]!.cron) }}
            <span v-if="upcomingSchedules[0]!.endTime"> → {{ upcomingSchedules[0]!.endTime }}</span>
          </template>
          <template v-else>未配置定时规则</template>
        </div>
      </div>
    </section>

    <!-- 主区 -->
    <section class="grid gap-3 xl:grid-cols-[minmax(0,1.62fr)_360px]">
      <!-- 账号矩阵 -->
      <div class="panel reveal min-w-0 overflow-hidden">
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div class="min-w-0">
            <div class="eyebrow">Account matrix</div>
            <div class="mt-1 flex items-baseline gap-2">
              <h2 class="text-[16px] font-semibold">账号运行矩阵</h2>
              <span class="mono text-[12px] text-muted-foreground">
                运行 {{ counts.running }} / 共 {{ accountsQuery.data.value?.length ?? 0 }}
              </span>
            </div>
          </div>
          <div class="relative ml-auto">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索账号 / 备注" class="h-8 w-48 pl-8 text-[13.5px]" />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          <button
            :class="cn('rounded-full border px-2.5 py-1 text-[13px] transition-colors', platformFilter === 'all' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
            @click="platformFilter = 'all'"
          >全部 {{ accountsQuery.data.value?.length ?? 0 }}</button>
          <button
            v-for="p in platformsQuery.data.value ?? []"
            :key="p.key"
            :class="cn('rounded-full border px-2.5 py-1 text-[13px] transition-colors', platformFilter === p.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
            @click="platformFilter = p.key"
          >{{ p.name }} {{ platformCounts[p.key] ?? 0 }}</button>
          <span class="mx-1 h-3.5 w-px bg-border" />
          <button
            v-for="s in [
              { key: 'running', label: '运行中', tone: 'mint' },
              { key: 'online', label: '在线', tone: 'ice' },
              { key: 'error', label: '异常', tone: 'coral' },
            ] as const"
            :key="s.key"
            :class="cn(
              'rounded-full border px-2.5 py-1 text-[13px] transition-colors',
              statusFilter === s.key
                ? s.tone === 'coral'
                  ? 'border-coral/40 bg-coral/10 text-coral'
                  : 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )"
            @click="statusFilter = s.key"
          >{{ s.label }} {{ counts[s.key] }}</button>
          <button
            v-if="statusFilter !== 'all'"
            class="rounded-full border border-border px-2 py-1 text-[13px] text-muted-foreground"
            @click="statusFilter = 'all'"
          ><X class="inline size-3" /></button>
        </div>

        <div v-if="accountsQuery.isLoading.value" class="space-y-2 p-4">
          <Skeleton v-for="i in 5" :key="i" class="h-14 w-full" />
        </div>
        <div v-else-if="!(accountsQuery.data.value ?? []).length" class="px-6 py-16 text-center">
          <div class="mx-auto grid size-12 place-items-center rounded-2xl border border-border bg-panel-2 text-primary">
            <Users class="size-5" />
          </div>
          <h2 class="mt-4 text-[16px] font-semibold">还没有账号</h2>
          <p class="mt-1 text-[14px] text-muted-foreground">添加平台账号后可批量发起任务，也能导入 config.yaml</p>
          <Button class="mt-4" @click="openAdd()"><Plus class="size-4" />接入账号</Button>
        </div>
        <div v-else class="overflow-x-auto">
          <div class="hidden min-w-[980px] grid-cols-[20px_minmax(168px,1.05fr)_82px_minmax(0,1.65fr)_132px_116px_92px] items-center gap-3 border-b border-border bg-panel-2/60 px-4 py-1.5 md:grid">
            <span />
            <span class="eyebrow !text-[10.5px]">账号 / 平台</span>
            <span class="eyebrow !text-[10.5px]">状态</span>
            <span class="eyebrow !text-[10.5px]">当前任务</span>
            <span class="eyebrow !text-[10.5px]">进度</span>
            <span class="eyebrow !text-[10.5px]">定时</span>
            <span class="eyebrow !text-right !text-[10.5px]">操作</span>
          </div>

          <template v-for="group in groups" :key="group.key">
            <div class="flex min-w-[980px] items-center gap-2 border-b border-border bg-panel-2/30 px-4 py-1.5">
              <span class="mono text-[12px] font-medium uppercase tracking-wider text-foreground/80">{{ group.name }}</span>
              <span class="mono text-[11.5px] text-muted-foreground">{{ group.items.length }}</span>
              <span class="h-px flex-1 bg-border" />
              <button class="mono text-[11.5px] text-muted-foreground hover:text-foreground" @click="toggleGroup(group.items)">
                {{ group.items.every((a) => selectedUids.includes(a.uid)) ? "取消全选" : "全选" }}
              </button>
            </div>
            <AccountRow
              v-for="account in group.items"
              :key="account.uid"
              :account="account"
              :platform-name="group.name"
              :job="latestByAccount[account.uid] ?? null"
              :progress="runningByAccount[account.uid] ? events.jobLive[runningByAccount[account.uid]!.id]?.lastProgress ?? null : null"
              :schedule="scheduleByAccount[account.uid] ?? null"
              :selected="selectedUids.includes(account.uid)"
              @toggle="toggle(account.uid)"
              @open="drawerUid = account.uid"
              @start="openStart([{ uid: account.uid, label: account.remark || account.username }])"
              @stop="stopMutation.mutate(runningByAccount[account.uid]!.id)"
            />
          </template>

          <div v-if="!groups.length" class="px-4 py-10 text-center text-[13.5px] text-muted-foreground">
            没有符合筛选条件的账号
          </div>
        </div>
      </div>

      <!-- 右侧遥测 -->
      <aside class="space-y-3">
        <div class="panel reveal px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div>
              <div class="eyebrow">14-day throughput</div>
              <div class="mt-1 text-[14.5px] font-medium">运行趋势</div>
            </div>
            <div class="text-right">
              <div class="mono text-[17px] font-semibold leading-none text-primary">
                {{ stats.reduce((s, d) => s + d.videos, 0) }}
              </div>
              <div class="mono text-[11px] text-muted-foreground">VIDEOS</div>
            </div>
          </div>
          <div class="mt-1 h-[168px]">
            <DailyTrend v-if="stats.length" :data="stats" />
            <Skeleton v-else class="h-full w-full" />
          </div>
        </div>

        <div class="panel reveal px-3.5 py-3">
          <div class="eyebrow">Account health</div>
          <div class="mt-1 text-[14.5px] font-medium">账号状态分布</div>
          <div class="mt-1 h-[146px]">
            <StatusDonut v-if="accountsQuery.data.value?.length" :counts="counts" />
            <div v-else class="grid h-full place-items-center text-[12.5px] text-muted-foreground">暂无账号</div>
          </div>
        </div>

        <div class="panel reveal px-3.5 py-3">
          <div class="flex items-baseline justify-between">
            <div>
              <div class="eyebrow">Today's schedule</div>
              <div class="mt-1 text-[14.5px] font-medium">今日定时</div>
            </div>
            <RouterLink to="/schedules" class="mono text-[11.5px] text-muted-foreground hover:text-primary">全部 →</RouterLink>
          </div>
          <div v-if="upcomingSchedules.length" class="mt-2.5 space-y-2">
            <div
              v-for="s in upcomingSchedules"
              :key="s.id"
              class="relative flex items-start gap-2.5 border-l border-border pl-2.5"
            >
              <span class="absolute -left-[3px] top-1.5 size-1.5 rounded-full bg-primary" />
              <div class="mono shrink-0 text-[13px] text-foreground">
                {{ timeOf(s.cron) }}
                <template v-if="s.endTime"><span class="text-muted-foreground"> → {{ s.endTime }}</span></template>
              </div>
              <div class="min-w-0">
                <div class="truncate text-[13px]">{{ s.name || "定时规则" }}</div>
                <div class="mono text-[11px] text-muted-foreground">{{ s.accountUids.length }} ACCOUNTS</div>
              </div>
            </div>
          </div>
          <p v-else class="mt-3 text-[12.5px] text-muted-foreground">尚未配置定时规则</p>
        </div>
      </aside>
    </section>

    <!-- 实时活动 -->
    <section class="panel reveal overflow-hidden">
      <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div class="eyebrow">Live stream</div>
        <h2 class="text-[14.5px] font-medium">实时活动</h2>
        <span class="mono ml-auto flex items-center gap-1.5 text-[11px] text-primary">
          <span class="size-1 animate-breathe rounded-full bg-primary" />SSE
        </span>
      </div>
      <div v-if="liveLogs.length" class="max-h-[168px] overflow-y-auto px-4 py-2">
        <div
          v-for="(l, i) in liveLogs"
          :key="i"
          class="flex items-baseline gap-2.5 border-b border-border/40 py-1.5 last:border-b-0"
        >
          <span class="mono shrink-0 text-[11.5px] text-muted-foreground/70">{{ clockOf(l.ts) }}</span>
          <span
            :class="cn(
              'mono w-9 shrink-0 text-[11px] uppercase',
              l.level === 'error' ? 'text-coral' : l.level === 'warn' ? 'text-amber' : 'text-primary/80',
            )"
          >{{ l.level ?? "info" }}</span>
          <span class="mono shrink-0 text-[11.5px] text-muted-foreground">{{ accountLabel(l.accountId) }}</span>
          <span class="min-w-0 flex-1 truncate text-[13px] text-foreground/80">{{ l.message }}</span>
        </div>
      </div>
      <p v-else class="px-4 py-6 text-center text-[13px] text-muted-foreground">
        发起任务后，日志会实时出现在这里
      </p>
    </section>

    <!-- 批量操作条 -->
    <div
      v-if="selectedUids.length"
      class="sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-background/90 px-4 py-2.5 shadow-xl backdrop-blur-xl"
    >
      <span class="mono text-[13px] text-primary">SELECTED {{ selectedUids.length }}</span>
      <span class="text-[13px] text-muted-foreground">
        {{ selectedRunning.length ? `${selectedRunning.length} 个运行中` : "各账号独立并发" }}
      </span>
      <div class="ml-auto flex items-center gap-1.5">
        <Button size="sm" class="h-7 text-[13.5px]" @click="openStart(selectedPayload)">发起任务</Button>
        <Button variant="outline" size="sm" class="h-7 text-[13.5px]" @click="openSchedule(selectedUids)">设定定时</Button>
        <Button variant="outline" size="sm" class="h-7 text-[13.5px]" @click="stopSelected">停止</Button>
        <Button variant="ghost" size="sm" class="h-7 text-[13.5px]" @click="selectedUids = []">取消</Button>
      </div>
    </div>

    <AddAccountDialog
      v-model:open="addOpen"
      :account="addEditing"
      @saved="queryClient.invalidateQueries({ queryKey: ['accounts'] })"
    />
    <StartJobDialog v-model:open="startOpen" :accounts="startPayload" @started="selectedUids = []" />
    <ScheduleDialog
      v-model:open="scheduleOpen"
      :accounts="(accountsQuery.data.value ?? []).map((a) => ({ uid: a.uid, label: a.remark || a.username }))"
      :preselected="schedulePreselect"
    />

    <AccountDrawer
      v-if="drawerAccount"
      :account="drawerAccount"
      :job="drawerJob"
      :progress="drawerProgress"
      :schedule="drawerSchedule"
      :open="!!drawerUid"
      @close="drawerUid = null"
      @stop="drawerJob && stopMutation.mutate(drawerJob.id)"
      @start="openStart([{ uid: drawerAccount.uid, label: drawerAccount.remark || drawerAccount.username }])"
      @verify="verifyMutation.mutate(drawerAccount.uid)"
      @edit="openAdd(drawerAccount)"
      @remove="askRemove(drawerAccount)"
    />
  </div>
</template>
