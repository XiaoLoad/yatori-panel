<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ChevronLeft, ChevronRight, ServerCog, ShieldCheck, Search, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/api/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmAction } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const queryClient = useQueryClient();
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts() });
const accounts = computed(() => accountsQuery.data.value ?? []);
const accountOptions = computed(() => [
  { value: "all", label: "全部账号" },
  ...accounts.value.map((a) => ({
    value: a.uid,
    label: a.remark ? `${a.remark} · ${a.username}` : a.username,
  })),
]);
function accountLabel(uid?: string): string {
  if (!uid) return "系统";
  const a = accounts.value.find((x) => x.uid === uid);
  return a ? a.remark || a.username : uid.slice(0, 8);
}

// ---------- 检索 ----------
const level = ref<"all" | "info" | "warn" | "error">("all");
const accountFilter = ref("all");
const jobFilter = ref("all");
const search = ref("");
const debouncedSearch = ref("");
let searchTimer: number | undefined;
watch(search, (value) => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    debouncedSearch.value = value.trim();
  }, 300);
});

// 运行中任务：作为「当前任务」筛选的数据源
const runningJobsQuery = useQuery({
  queryKey: ["running-jobs"],
  queryFn: () => api.jobs({ state: "running", limit: 50 }, { silent: true }),
  refetchInterval: 5_000,
});
const runningJobs = computed(() => runningJobsQuery.data.value ?? []);
const jobOptions = computed(() => [
  { value: "all", label: "全部任务" },
  ...runningJobs.value.map((j) => ({
    value: j.id,
    label: `${accountLabel(j.accountUid)} · ${startTime(j.startedAt)}`,
  })),
]);
function startTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
// 任务结束后自动回到全部任务，避免筛选停留在已结束的 jobId
watch(runningJobs, (list) => {
  if (jobFilter.value !== "all" && !list.some((j) => j.id === jobFilter.value)) {
    jobFilter.value = "all";
  }
});

watch([level, accountFilter, jobFilter, debouncedSearch], () => {
  page.value = 1;
});

const page = ref(1);
const pageSize = ref(20);
const logsQuery = useQuery({
  queryKey: computed(() => [
    "logs-page",
    {
      level: level.value,
      accountUid: accountFilter.value,
      jobId: jobFilter.value,
      search: debouncedSearch.value,
      page: page.value,
      pageSize: pageSize.value,
    },
  ]),
  queryFn: () =>
    api.logsPage(
      {
        level: level.value,
        accountUid: accountFilter.value === "all" ? undefined : accountFilter.value,
        jobId: jobFilter.value === "all" ? undefined : jobFilter.value,
        search: debouncedSearch.value || undefined,
        page: page.value,
        pageSize: pageSize.value,
      },
      { silent: true },
    ),
  refetchInterval: 20_000,
});

const logs = computed(() => logsQuery.data.value?.items ?? []);
const total = computed(() => logsQuery.data.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});
watch(pageSize, () => {
  page.value = 1;
});

const LEVEL_TABS = [
  { key: "all", label: "全部" },
  { key: "info", label: "信息" },
  { key: "warn", label: "警告" },
  { key: "error", label: "错误" },
] as const;

function levelLabel(l?: string): string {
  return { debug: "调试", info: "信息", warn: "警告", error: "错误" }[l ?? "info"] ?? (l ?? "信息");
}
function levelTone(l?: string): string {
  if (l === "error") return "border-coral/30 bg-coral/10 text-coral";
  if (l === "warn") return "border-amber/30 bg-amber/10 text-amber";
  if (l === "debug") return "border-border bg-muted text-muted-foreground";
  return "border-primary/30 bg-primary/10 text-primary";
}
function timeOf(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ---------- 按时间段删除 ----------
/** 结束日期（含当天）最晚只能选 8 天前，保证被删日志都在近 7 天之外 */
function dateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const maxDeleteDate = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() - 8);
  return dateString(d);
});

const deleteFrom = ref("");
const deleteTo = ref("");
const deleteMutation = useMutation({
  mutationFn: (body: { from: string; to: string }) => api.deleteLogs(body),
  onSuccess: (r) => {
    toast.success(`已删除 ${r.deleted} 条历史日志`);
    deleteFrom.value = "";
    deleteTo.value = "";
    void queryClient.invalidateQueries({ queryKey: ["logs-page"] });
    void queryClient.invalidateQueries({ queryKey: ["logs"] });
  },
  onError: (err) => toastError(err, "删除日志失败"),
});

async function askDeleteLogs() {
  if (!deleteFrom.value || !deleteTo.value) {
    toast.error("请选择开始日期和结束日期");
    return;
  }
  if (deleteFrom.value > deleteTo.value) {
    toast.error("开始日期不能晚于结束日期");
    return;
  }
  if (deleteTo.value > maxDeleteDate.value) {
    toast.error(`结束日期最晚可选 ${maxDeleteDate.value}，近 7 天日志不可删除`);
    return;
  }
  const from = new Date(`${deleteFrom.value}T00:00:00`);
  const to = new Date(`${deleteTo.value}T00:00:00`);
  to.setDate(to.getDate() + 1);
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    toast.error("单次最多删除 366 天内的日志");
    return;
  }
  const ok = await confirmAction({
    title: `删除 ${deleteFrom.value} 至 ${deleteTo.value} 的日志？`,
    description: "该时间段内的历史日志会被永久删除，近 7 天日志受保护不受影响，该操作不可撤销。",
    confirmText: "删除日志",
    tone: "danger",
  });
  if (ok) deleteMutation.mutate({ from: from.toISOString(), to: to.toISOString() });
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <h1 class="display-title text-[26px] leading-none">日志</h1>
        <p class="mt-2 text-[14px] text-muted-foreground">
          全站运行日志 · 按级别、账号与关键字检索，历史日志可按时间段清理
        </p>
      </div>
      <span class="mono ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span class="size-1.5 animate-breathe rounded-full bg-primary" />每 20 秒自动刷新
      </span>
    </header>

    <section class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <!-- 日志列表 -->
      <div class="panel flex min-w-0 flex-col overflow-hidden">
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 class="text-[16px] font-semibold">日志检索</h2>
            <span class="mono text-[12px] text-muted-foreground">匹配 {{ total }} 条</span>
          </div>
          <div class="relative ml-auto">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" placeholder="搜索日志内容" class="h-8 w-56 pl-8 text-[13px]" />
          </div>
          <Select v-model="accountFilter" :options="accountOptions" class="h-8 w-48 text-[13px]" />
          <Select v-model="jobFilter" :options="jobOptions" class="h-8 w-56 text-[13px]" />
        </div>

        <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          <button
            v-for="tab in LEVEL_TABS"
            :key="tab.key"
            :class="cn(
              'rounded-md border px-2.5 py-1 text-[13px] transition-colors',
              level === tab.key
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )"
            @click="level = tab.key"
          >{{ tab.label }}</button>
          <span class="text-[12px] text-muted-foreground">任务筛选只列出运行中的任务</span>
          <span class="mono ml-auto text-[12px] text-muted-foreground">共 {{ total }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
        </div>

        <div v-if="logsQuery.isLoading.value" class="h-[520px] space-y-2 overflow-hidden p-4">
          <Skeleton v-for="i in 10" :key="i" class="h-8 w-full" />
        </div>
        <div v-else-if="!logs.length" class="flex h-[520px] flex-col items-center justify-center px-6 text-center">
          <div class="mx-auto grid size-12 place-items-center rounded-lg border border-border bg-panel-2 text-muted-foreground">
            <ServerCog class="size-5" />
          </div>
          <h2 class="mt-4 text-[16px] font-semibold">该条件下没有日志</h2>
          <p class="mt-1 text-[14px] text-muted-foreground">调整级别、账号、任务或关键字后再试</p>
        </div>
        <div v-else class="h-[520px] overflow-y-auto overscroll-contain">
          <div
            v-for="(log, i) in logs"
            :key="`${log.ts}-${i}`"
            class="flex flex-wrap items-start gap-x-2.5 gap-y-1 border-b border-border/60 px-4 py-2 last:border-b-0 hover:bg-accent/40"
          >
            <span class="mono shrink-0 text-[12px] text-muted-foreground">{{ timeOf(log.ts) }}</span>
            <span :class="cn('mono shrink-0 rounded border px-1.5 text-[11.5px] uppercase', levelTone(log.level))">
              {{ levelLabel(log.level) }}
            </span>
            <span class="shrink-0 text-[12px] text-muted-foreground">{{ accountLabel(log.accountId) }}</span>
            <span class="min-w-0 flex-1 break-words text-[13px] text-foreground/85">{{ log.message }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <span class="mono text-[12px] text-muted-foreground">共 {{ total }} 条 · 第 {{ page }}/{{ pageCount }} 页</span>
          <div class="ml-auto flex items-center gap-1.5">
            <Select
              :model-value="String(pageSize)"
              :options="[
                { value: '20', label: '每页 20 条' },
                { value: '50', label: '每页 50 条' },
                { value: '100', label: '每页 100 条' },
              ]"
              class="h-7 w-28 text-[12.5px]"
              @update:model-value="pageSize = Number($event)"
            />
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-[12.5px]"
              :disabled="page <= 1"
              @click="page -= 1"
            ><ChevronLeft class="size-3.5" />上一页</Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 text-[12.5px]"
              :disabled="page >= pageCount"
              @click="page += 1"
            >下一页<ChevronRight class="size-3.5" /></Button>
          </div>
        </div>
      </div>

      <!-- 清理 -->
      <aside class="flex flex-col gap-3">
        <div class="panel px-4 py-4">
          <div class="flex items-center gap-2.5">
            <div class="grid size-8 place-items-center rounded-lg bg-coral/10 text-coral"><Trash2 class="size-4" /></div>
            <div>
              <h2 class="text-[15.5px] font-semibold">清理历史日志</h2>
              <p class="text-[12.5px] text-muted-foreground">只能按时间段删除</p>
            </div>
          </div>

          <div class="mt-3.5 grid gap-2.5">
            <div class="grid gap-1.5">
              <Label class="text-[13px]">开始日期</Label>
              <Input v-model="deleteFrom" type="date" :max="maxDeleteDate" class="h-8 text-[13px]" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-[13px]">结束日期（含当天）</Label>
              <Input v-model="deleteTo" type="date" :max="maxDeleteDate" class="h-8 text-[13px]" />
            </div>
            <Button
              variant="destructive"
              size="sm"
              class="mt-1 h-8 gap-1.5 text-[13px]"
              :disabled="deleteMutation.isPending.value || !deleteFrom || !deleteTo"
              @click="askDeleteLogs"
            ><Trash2 class="size-3.5" />{{ deleteMutation.isPending.value ? "删除中…" : "删除该时间段日志" }}</Button>
            <p class="text-[12px] leading-relaxed text-muted-foreground">
              结束日期最晚可选 <span class="mono text-foreground/80">{{ maxDeleteDate }}</span>，当天的日志也会被删除。
            </p>
          </div>
        </div>

        <div class="panel px-4 py-4">
          <div class="flex items-center gap-2">
            <ShieldCheck class="size-4 text-mint" />
            <h2 class="text-[14.5px] font-semibold">保护规则</h2>
          </div>
          <ul class="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <li>· 近 7 天内的日志固定保护，无法删除</li>
            <li>· 仅支持按时间段删除，不接受单条删除</li>
            <li>· 单次最多删除 366 天范围内的日志</li>
            <li>· 删除仅影响日志，任务记录与产出统计不受影响</li>
          </ul>
        </div>
      </aside>
    </section>
  </div>
</template>
