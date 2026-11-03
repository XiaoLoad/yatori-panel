<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { AlarmClock, ChevronRight, Plus, Search, SquarePlay, Users } from "lucide-vue-next";
import { computed, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import type { JobEvent, JobVO, ScheduleVO } from "@yatori/shared";
import type { AccountWithSession } from "@/api/resources";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import AddAccountDialog from "@/components/account/AddAccountDialog.vue";
import StartJobDialog from "@/components/account/StartJobDialog.vue";
import ScheduleDialog from "@/components/account/ScheduleDialog.vue";
import { useEventStore } from "@/stores/events";
import { toastError } from "@/lib/errors";
import { confirmAction } from "@/lib/confirm";
import { accountStatus, overallPercent, phaseLabel, progressDetail, scheduleWindow, statusMeta } from "@/lib/account";
import { cn } from "@/lib/utils";

const router = useRouter();
const queryClient = useQueryClient();
const events = useEventStore();

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms });
const jobsQuery = useQuery({
  queryKey: ["jobs"],
  queryFn: () => api.jobs({ limit: 120 }),
  refetchInterval: 5_000,
});
const schedulesQuery = useQuery({
  queryKey: ["schedules"],
  queryFn: api.schedules,
  refetchInterval: 30_000,
});

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

const platformCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const a of accountsQuery.data.value ?? []) counts[a.platform] = (counts[a.platform] ?? 0) + 1;
  return counts;
});

function statusOf(a: AccountWithSession) {
  return accountStatus(a, runningByAccount.value[a.uid]);
}

const counts = computed(() => {
  const c = { running: 0, online: 0, error: 0, idle: 0 };
  for (const a of accountsQuery.data.value ?? []) c[statusOf(a)] += 1;
  return c;
});

// ---------- 筛选 ----------
const platformFilter = ref("all");
const statusFilter = ref<"all" | "running" | "online" | "error" | "idle">("all");
const search = ref("");

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const order = (platformsQuery.data.value ?? []).map((p) => p.key);
  return [...(accountsQuery.data.value ?? [])]
    .filter((a) => {
      if (platformFilter.value !== "all" && a.platform !== platformFilter.value) return false;
      if (statusFilter.value !== "all" && statusOf(a) !== statusFilter.value) return false;
      if (!q) return true;
      return [a.remark, a.username, platformName.value[a.platform]].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    })
    .sort((x, y) => {
      const ix = order.indexOf(x.platform);
      const iy = order.indexOf(y.platform);
      if (ix !== iy) return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
      return (x.remark || x.username).localeCompare(y.remark || y.username, "zh-CN");
    });
});

function liveProgress(uid: string): JobEvent | null {
  const job = runningByAccount.value[uid];
  return job ? events.jobLive[job.id]?.lastProgress ?? job.progress ?? null : null;
}

function percentOf(uid: string): number {
  const progress = liveProgress(uid);
  const overall = overallPercent(progress);
  if (overall !== null) return overall;
  const p = progress?.progress;
  if (typeof p === "number") return Math.min(100, Math.max(0, Math.round(p)));
  const job = latestByAccount.value[uid];
  return job?.state === "done" ? 100 : 0;
}

// ---------- 选择 ----------
const selectedUids = ref<string[]>([]);
const selectedAccounts = computed(() =>
  (accountsQuery.data.value ?? []).filter((a) => selectedUids.value.includes(a.uid)),
);
const selectedPayload = computed(() =>
  selectedAccounts.value.map((a) => ({ uid: a.uid, label: a.remark || a.username })),
);
const selectedRunning = computed(() =>
  selectedAccounts.value.map((a) => runningByAccount.value[a.uid]).filter((j): j is JobVO => !!j),
);

function toggle(uid: string) {
  selectedUids.value = selectedUids.value.includes(uid)
    ? selectedUids.value.filter((x) => x !== uid)
    : [...selectedUids.value, uid];
}

const allVisibleSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((a) => selectedUids.value.includes(a.uid)),
);

function toggleAll() {
  const uids = filtered.value.map((a) => a.uid);
  selectedUids.value = allVisibleSelected.value
    ? selectedUids.value.filter((u) => !uids.includes(u))
    : [...new Set([...selectedUids.value, ...uids])];
}

// ---------- 弹窗与操作 ----------
const addOpen = ref(false);
const addEditing = ref<AccountWithSession | null>(null);
const startOpen = ref(false);
const scheduleOpen = ref(false);
const startPayload = ref<{ uid: string; label: string }[]>([]);
const schedulePreselect = ref<string[]>([]);

function openAdd(account: AccountWithSession | null = null) {
  addEditing.value = account;
  addOpen.value = true;
}
function openStart(accounts: { uid: string; label: string }[]) {
  startPayload.value = accounts;
  startOpen.value = true;
}

const stopMutation = useMutation({
  mutationFn: (id: string) => api.stopJob(id),
  onSuccess: (r) => {
    if (r.stopped) toast.info("已请求停止，任务正在收尾");
    else toast.warning(r.reason ?? "任务已结束");
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

async function askStop(account: AccountWithSession) {
  const job = runningByAccount.value[account.uid];
  if (!job) return;
  const ok = await confirmAction({
    title: `停止「${account.remark || account.username}」的任务？`,
    description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
    confirmText: "停止任务",
    tone: "danger",
  });
  if (ok) stopMutation.mutate(job.id);
}

async function stopSelected() {
  const targets = selectedRunning.value;
  if (!targets.length) {
    toast.info("所选账号没有运行中的任务");
    return;
  }
  const ok = await confirmAction({
    title: `停止所选 ${targets.length} 个任务？`,
    description: "停止后任务立即结束，未完成节点的进度不会保留，该操作不可撤销。",
    confirmText: "全部停止",
    tone: "danger",
  });
  if (!ok) return;
  for (const job of targets) stopMutation.mutate(job.id);
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">账号</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">
          账号列表与运行状态，点击任意账号查看课程进度与日志
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="scheduleOpen = true; schedulePreselect = []">
          <AlarmClock class="size-3.5" />定时规则
        </Button>
        <Button size="sm" class="h-8 gap-1.5 text-[13.5px]" @click="openAdd()">
          <Plus class="size-3.5" />接入账号
        </Button>
      </div>
    </header>

    <section class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 class="text-[16px] font-semibold">全部账号</h2>
          <span class="mono text-[12px] text-muted-foreground">
            {{ filtered.length }} / {{ accountsQuery.data.value?.length ?? 0 }} 个
          </span>
        </div>
        <div class="relative ml-auto">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" placeholder="搜索账号 / 备注" class="h-8 w-52 pl-8 text-[13.5px]" />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        <button
          :class="cn('rounded-md border px-2.5 py-1 text-[13px] transition-colors', platformFilter === 'all' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
          @click="platformFilter = 'all'"
        >全部 {{ accountsQuery.data.value?.length ?? 0 }}</button>
        <button
          v-for="p in platformsQuery.data.value ?? []"
          :key="p.key"
          :class="cn('rounded-md border px-2.5 py-1 text-[13px] transition-colors', platformFilter === p.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
          @click="platformFilter = p.key"
        >{{ p.name }} {{ platformCounts[p.key] ?? 0 }}</button>
        <span class="mx-1 h-3.5 w-px bg-border" />
        <button
          v-for="s in [
            { key: 'running', label: '运行中' },
            { key: 'online', label: '在线' },
            { key: 'error', label: '异常' },
            { key: 'idle', label: '待登录' },
          ] as const"
          :key="s.key"
          :class="cn('rounded-md border px-2.5 py-1 text-[13px] transition-colors', statusFilter === s.key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')"
          @click="statusFilter = s.key"
        >{{ s.label }} {{ counts[s.key] }}</button>
        <button
          v-if="statusFilter !== 'all'"
          class="rounded-md border border-border px-2 py-1 text-[13px] text-muted-foreground"
          @click="statusFilter = 'all'"
        >重置</button>
      </div>

      <div v-if="accountsQuery.isLoading.value" class="space-y-2 p-4">
        <Skeleton v-for="i in 6" :key="i" class="h-12 w-full" />
      </div>
      <div v-else-if="!(accountsQuery.data.value ?? []).length" class="px-6 py-16 text-center">
        <div class="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-panel-2 text-muted-foreground">
          <Users class="size-5" />
        </div>
        <h2 class="mt-4 text-[16px] font-semibold">还没有账号</h2>
        <p class="mt-1 text-[14px] text-muted-foreground">接入平台账号后可批量发起任务，也能导入 config.yaml</p>
        <Button class="mt-4" @click="openAdd()"><Plus class="size-4" />接入账号</Button>
      </div>
      <div v-else class="overflow-x-auto">
        <div class="hidden min-w-[1060px] grid-cols-[24px_minmax(200px,1.1fr)_92px_minmax(0,1.5fr)_150px_128px_132px_168px] items-center gap-3 border-b border-border bg-panel-2 px-4 py-1.5 text-[12px] text-muted-foreground md:grid">
          <Checkbox :model-value="allVisibleSelected" @update:model-value="toggleAll" />
          <span>账号 / 平台</span>
          <span>状态</span>
          <span>当前任务</span>
          <span>进度</span>
          <span>最近产出</span>
          <span>定时</span>
          <span class="text-right">操作</span>
        </div>

        <div v-if="!filtered.length" class="px-4 py-12 text-center text-[13.5px] text-muted-foreground">
          没有符合筛选条件的账号
        </div>
        <template v-else>
          <div
            v-for="account in filtered"
            :key="account.uid"
            :class="cn(
              'group grid min-w-[1060px] cursor-pointer items-center gap-3 border-b border-border/70 px-4 py-2.5 transition-colors last:border-b-0',
              'grid-cols-[24px_minmax(200px,1.1fr)_92px_minmax(0,1.5fr)_150px_128px_132px_168px]',
              selectedUids.includes(account.uid) ? 'bg-primary/5' : 'hover:bg-accent/60',
            )"
            @click="router.push(`/accounts/${account.uid}`)"
          >
            <span @click.stop><Checkbox :model-value="selectedUids.includes(account.uid)" @update:model-value="toggle(account.uid)" /></span>

            <div class="flex min-w-0 items-center gap-2.5">
              <div class="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-panel-2 text-[13.5px] font-semibold text-primary">
                {{ (account.remark || account.username).slice(0, 1) }}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-[14.5px] font-medium">{{ account.remark || account.username }}</span>
                  <span class="mono shrink-0 rounded border border-border px-1 text-[12px] text-muted-foreground">{{ platformName[account.platform] ?? account.platform }}</span>
                  <span v-if="!account.enabled" class="shrink-0 rounded bg-muted px-1 text-[12px] text-muted-foreground">已停用</span>
                </div>
                <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">{{ account.username }}</div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 text-[13px]" :class="statusMeta(statusOf(account)).text">
              <span class="size-1.5 rounded-full" :class="[statusMeta(statusOf(account)).dot, statusOf(account) === 'running' && 'animate-breathe']" />
              {{ statusMeta(statusOf(account)).label }}
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span
                  :class="cn(
                    'stage-chip shrink-0',
                    statusOf(account) === 'running' ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground',
                  )"
                >{{ phaseLabel(liveProgress(account.uid), statusOf(account) === 'running') }}</span>
                <span class="min-w-0 truncate text-[13.5px]">
                  {{ progressDetail(liveProgress(account.uid)) || "未启动" }}
                </span>
              </div>
              <div class="mono mt-0.5 truncate text-[12px] text-muted-foreground">
                <template v-if="liveProgress(account.uid)?.watchedSeconds !== undefined">
                  已看 {{ Math.floor((liveProgress(account.uid)?.watchedSeconds ?? 0) / 60) }} 分钟
                  <template v-if="liveProgress(account.uid)?.totalSeconds"> / {{ Math.floor((liveProgress(account.uid)?.totalSeconds ?? 0) / 60) }} 分钟</template>
                </template>
                <template v-else-if="latestByAccount[account.uid]">
                  上次任务 {{ latestByAccount[account.uid]?.state === "done" ? "已完成" : latestByAccount[account.uid]?.state === "error" ? "出错" : "已停止" }}
                </template>
                <template v-else>—</template>
              </div>
            </div>

            <div class="min-w-0">
              <div class="flex items-baseline justify-between text-[12.5px] text-muted-foreground">
                <span>{{ statusOf(account) === "running" ? "实时" : "累计" }}</span>
                <span class="mono">{{ percentOf(account.uid) }}%</span>
              </div>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-[width] duration-500" :style="{ width: `${percentOf(account.uid)}%` }" />
              </div>
            </div>

            <div class="mono text-[12.5px] leading-5">
              <template v-if="latestByAccount[account.uid]?.summary">
                <div>视频 {{ latestByAccount[account.uid]?.summary?.videosCompleted }}</div>
                <div class="text-muted-foreground">作业 {{ latestByAccount[account.uid]?.summary?.worksDone }} · 考试 {{ latestByAccount[account.uid]?.summary?.examsDone }}</div>
              </template>
              <span v-else class="text-muted-foreground">—</span>
            </div>

            <div class="text-[12.5px] leading-5">
              <template v-if="scheduleWindow(scheduleByAccount[account.uid])">
                <div class="mono truncate">{{ scheduleWindow(scheduleByAccount[account.uid])?.time }}</div>
                <div class="truncate text-muted-foreground">{{ scheduleWindow(scheduleByAccount[account.uid])?.name }}</div>
              </template>
              <span v-else class="text-muted-foreground">未设定时</span>
            </div>

            <div class="flex items-center justify-end gap-1" @click.stop>
              <button
                v-if="statusOf(account) === 'running'"
                class="rounded border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-coral/40 hover:text-coral"
                @click="askStop(account)"
              >停止</button>
              <button
                v-else
                class="rounded border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                @click="openStart([{ uid: account.uid, label: account.remark || account.username }])"
              >启动</button>
              <button
                class="rounded px-1.5 py-1 text-[12.5px] text-muted-foreground hover:text-primary"
                title="检测登录"
                @click="verifyMutation.mutate(account.uid)"
              >检测</button>
              <RouterLink :to="`/accounts/${account.uid}`" class="inline-flex items-center rounded px-1 py-1 text-[12.5px] text-muted-foreground hover:text-primary">
                <ChevronRight class="size-3.5" />
              </RouterLink>
            </div>
          </div>
        </template>
      </div>
    </section>

    <div
      v-if="selectedUids.length"
      class="sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card px-4 py-2.5 shadow-lg"
    >
      <span class="mono text-[13px] text-primary">已选 {{ selectedUids.length }}</span>
      <span class="text-[13px] text-muted-foreground">
        {{ selectedRunning.length ? `${selectedRunning.length} 个运行中` : "各账号独立并发" }}
      </span>
      <div class="ml-auto flex items-center gap-1.5">
        <Button size="sm" class="h-7 gap-1 text-[13px]" @click="openStart(selectedPayload)">
          <SquarePlay class="size-3.5" />发起任务
        </Button>
        <Button variant="outline" size="sm" class="h-7 text-[13px]" @click="scheduleOpen = true; schedulePreselect = selectedUids">设定定时</Button>
        <Button variant="outline" size="sm" class="h-7 text-[13px]" @click="stopSelected">停止</Button>
        <Button variant="ghost" size="sm" class="h-7 text-[13px]" @click="selectedUids = []">取消</Button>
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
  </div>
</template>
