<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { ListChecks, Plus, Users } from "lucide-vue-next";
import { computed } from "vue";
import { api } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState.vue";
import { useEventStore } from "@/stores/events";
import { relativeTime } from "@/lib/utils";

const events = useEventStore();
const dashQuery = useQuery({
  queryKey: ["dashboard"],
  queryFn: api.dashboard,
  refetchInterval: 5000,
});

const dash = computed(() => dashQuery.data.value);
const liveJobs = computed(() =>
  Object.entries(events.jobLive).filter(([, s]) => s.state === "running"),
);

const stats = computed(() => [
  { label: "账号总数", value: dash.value?.accountCount, hint: "已录入面板的平台账号", icon: Users },
  { label: "在线会话", value: dash.value?.onlineAccounts, hint: "当前保持登录的账号", icon: Users },
  { label: "运行中任务", value: dash.value?.runningJobs, hint: "正在提交学时的任务", icon: ListChecks },
]);

function stateBadge(state: string) {
  switch (state) {
    case "running":
      return { variant: "success" as const, text: "运行中" };
    case "done":
      return { variant: "secondary" as const, text: "已完成" };
    case "error":
      return { variant: "destructive" as const, text: "出错" };
    default:
      return { variant: "outline" as const, text: "已停止" };
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">仪表盘</h1>
        <p class="mt-1 text-sm text-muted-foreground">账号、会话与任务的总体状态</p>
      </div>
      <Button as-child>
        <RouterLink to="/jobs"><Plus />发起任务</RouterLink>
      </Button>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <Card v-for="s in stats" :key="s.label">
        <CardContent class="p-5">
          <div class="flex items-center gap-3">
            <div class="flex size-9 items-center justify-center rounded-lg bg-muted">
              <component :is="s.icon" class="size-4 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-sm text-muted-foreground">{{ s.label }}</p>
              <p class="text-2xl font-bold tabular-nums leading-tight">
                <template v-if="dashQuery.isLoading.value">
                  <Skeleton class="mt-1 h-7 w-10" />
                </template>
                <template v-else>{{ s.value ?? "-" }}</template>
              </p>
            </div>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">{{ s.hint }}</p>
        </CardContent>
      </Card>
    </div>

    <Card v-if="liveJobs.length">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-base">
          <ListChecks class="size-4" />进行中的任务
        </CardTitle>
        <CardDescription>进度实时更新，来自 SSE 事件流</CardDescription>
      </CardHeader>
      <CardContent class="space-y-5">
        <div v-for="[jobId, s] in liveJobs" :key="jobId" class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="min-w-0 truncate text-sm font-medium">
              {{ s.lastProgress?.courseName ?? "准备中…" }}
              <span v-if="s.lastProgress" class="font-normal text-muted-foreground">
                / {{ s.lastProgress.nodeName }}
              </span>
            </p>
            <span class="text-sm font-semibold tabular-nums">
              {{ Math.round(s.lastProgress?.progress ?? 0) }}%
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-primary/10">
            <div
              class="h-full rounded-full bg-primary transition-all duration-500"
              :style="{ width: `${Math.min(100, s.lastProgress?.progress ?? 0)}%` }"
            />
          </div>
          <p class="text-xs text-muted-foreground">
            已观看 {{ s.lastProgress?.watchedSeconds ?? 0 }}s /
            {{ s.lastProgress?.totalSeconds || "?" }}s
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="space-y-1">
          <CardTitle class="text-base">最近任务</CardTitle>
          <CardDescription>最近 5 次任务</CardDescription>
        </div>
        <Button variant="outline" size="sm" as-child>
          <RouterLink to="/jobs">全部任务</RouterLink>
        </Button>
      </CardHeader>
      <CardContent>
        <div v-if="dashQuery.isLoading.value" class="space-y-2">
          <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
        </div>
        <EmptyState
          v-else-if="!dash?.recentJobs?.length"
          :icon="ListChecks"
          title="还没有任务"
          description="到任务控制台选择账号和课程，发起第一次刷课"
        />
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead class="w-24">状态</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>结果</TableHead>
              <TableHead class="max-w-64">错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="job in dash.recentJobs" :key="job.id">
              <TableCell>
                <Badge :variant="stateBadge(job.state).variant">{{ stateBadge(job.state).text }}</Badge>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ relativeTime(job.startedAt) }}
              </TableCell>
              <TableCell>
                <div class="flex flex-wrap items-center gap-1.5 text-xs" v-if="job.summary">
                  <Badge v-if="job.summary.videosCompleted" variant="secondary" class="tabular-nums">
                    视频 {{ job.summary.videosCompleted }}
                  </Badge>
                  <Badge v-if="job.summary.flagsFound" variant="warning" class="tabular-nums">
                    标红 {{ job.summary.flagsFound }}
                  </Badge>
                  <Badge v-if="job.summary.worksDone" variant="secondary" class="tabular-nums">
                    作业 {{ job.summary.worksDone }}
                  </Badge>
                  <span v-if="!job.summary.videosCompleted && !job.summary.flagsFound" class="text-muted-foreground">
                    -
                  </span>
                </div>
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell class="max-w-56">
                <span class="block truncate text-red-500" :title="job.summary?.errors?.join('；')">
                  {{ job.summary?.errors?.join("；") || "-" }}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
