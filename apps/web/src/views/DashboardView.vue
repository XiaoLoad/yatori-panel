<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { ListChecks, Plus, Users, Video } from "lucide-vue-next";
import { computed, ref } from "vue";
import { api, type CourseDTO } from "@/api/resources";
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
import AnimatedNumber from "@/components/viz/AnimatedNumber.vue";
import CourseBarsChart, { type CourseBar } from "@/components/viz/CourseBarsChart.vue";
import StatRing from "@/components/viz/StatRing.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useEventStore } from "@/stores/events";
import { useReveal } from "@/composables/useReveal";
import { relativeTime } from "@/lib/utils";

const events = useEventStore();
const root = ref<HTMLElement | null>(null);
useReveal(() => root.value);

const dashQuery = useQuery({
  queryKey: ["dashboard"],
  queryFn: api.dashboard,
  refetchInterval: 5000,
});
const dash = computed(() => dashQuery.data.value);

// 聚合进度：只对已有会话的账号拉课程（不隐式登录）
const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
const sessionAccounts = computed(() =>
  (accountsQuery.data.value ?? []).filter((a) => a.hasSession),
);

const progressQuery = useQuery({
  queryKey: computed(() => ["dash-progress", sessionAccounts.value.map((a) => a.uid).join(",")]),
  queryFn: async () => {
    const out: Record<string, CourseDTO[]> = {};
    await Promise.all(
      sessionAccounts.value.map(async (a) => {
        out[a.uid] = await api.courses(a.uid);
      }),
    );
    return out;
  },
  enabled: computed(() => sessionAccounts.value.length > 0),
});

const allCourses = computed(() =>
  sessionAccounts.value.flatMap((a) => (progressQuery.data.value?.[a.uid] ?? [])),
);

const avgProgress = computed(() => {
  const list = allCourses.value;
  if (!list.length) return 0;
  return list.reduce((sum, c) => sum + Math.min(100, c.progress), 0) / list.length;
});

const finishedCourses = computed(
  () => allCourses.value.filter((c) => c.progress >= 100).length,
);

const chartItems = computed<CourseBar[]>(() => {
  const byName = new Map<string, { sum: number; n: number }>();
  for (const c of allCourses.value) {
    const cur = byName.get(c.name) ?? { sum: 0, n: 0 };
    cur.sum += Math.min(100, c.progress);
    cur.n += 1;
    byName.set(c.name, cur);
  }
  return [...byName.entries()].map(([name, v]) => ({
    name,
    progress: v.sum / v.n,
  }));
});

const liveJobs = computed(() =>
  Object.entries(events.jobLive).filter(([, s]) => s.state === "running"),
);

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
  <div ref="root" class="space-y-6">
    <div class="reveal flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">仪表盘</h1>
        <p class="mt-1 text-sm text-muted-foreground">学习进度总览</p>
      </div>
      <Button as-child>
        <RouterLink to="/jobs"><Plus />发起任务</RouterLink>
      </Button>
    </div>

    <!-- Hero：总进度环 + 计数器 + 课程进度图 -->
    <div class="reveal grid gap-4 xl:grid-cols-[400px_1fr]">
      <Card>
        <CardContent class="flex items-center gap-6 p-6">
          <StatRing
            :value="avgProgress"
            :size="160"
            label="平均进度"
            :sublabel="`${allCourses.length} 门课程`"
          />
          <div class="grid flex-1 grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <div class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <Users class="size-3.5 shrink-0" />账号
              </div>
              <div class="mt-1 text-2xl font-bold tabular-nums leading-none">
                <AnimatedNumber :value="dash?.accountCount ?? 0" />
              </div>
            </div>
            <div>
              <div class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <Video class="size-3.5 shrink-0" />已完成课程
              </div>
              <div class="mt-1 text-2xl font-bold tabular-nums leading-none">
                <AnimatedNumber :value="finishedCourses" />
              </div>
            </div>
            <div>
              <div class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <ListChecks class="size-3.5 shrink-0" />运行中任务
              </div>
              <div class="mt-1 text-2xl font-bold tabular-nums leading-none">
                <AnimatedNumber :value="dash?.runningJobs ?? 0" />
              </div>
            </div>
            <div>
              <div class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <Video class="size-3.5 shrink-0" />在线会话
              </div>
              <div class="mt-1 text-2xl font-bold tabular-nums leading-none">
                <AnimatedNumber :value="dash?.onlineAccounts ?? 0" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-0">
          <CardTitle class="text-base">各课程进度</CardTitle>
          <CardDescription>同名课程跨账号取平均</CardDescription>
        </CardHeader>
        <CardContent>
          <div v-if="progressQuery.isLoading.value" class="space-y-3 py-2">
            <Skeleton v-for="i in 3" :key="i" class="h-6 w-full" />
          </div>
          <EmptyState
            v-else-if="!chartItems.length"
            :icon="Video"
            title="暂无课程数据"
            description="账号登录后这里会显示每门课程的进度条形图"
          />
          <CourseBarsChart v-else :items="chartItems" :height="Math.max(120, chartItems.length * 40)" />
        </CardContent>
      </Card>
    </div>

    <!-- 进行中任务 -->
    <Card v-if="liveJobs.length" class="reveal">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base">
          <ListChecks class="size-4" />进行中的任务
        </CardTitle>
      </CardHeader>
      <CardContent class="grid gap-5 md:grid-cols-2">
        <div v-for="[jobId, s] in liveJobs" :key="jobId" class="space-y-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="min-w-0 truncate text-sm font-medium">
              {{ s.lastProgress?.courseName ?? "准备中…" }}
              <span v-if="s.lastProgress" class="font-normal text-muted-foreground">
                / {{ s.lastProgress.nodeName }}
              </span>
            </p>
            <span class="text-lg font-bold tabular-nums leading-none">
              {{ Math.round(s.lastProgress?.progress ?? 0) }}%
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-primary/10">
            <div
              class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
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

    <!-- 最近任务 -->
    <Card class="reveal">
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <div class="space-y-1">
          <CardTitle class="text-base">最近任务</CardTitle>
          <CardDescription>最近 5 次</CardDescription>
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
              <TableHead class="max-w-56">错误</TableHead>
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
                <div v-if="job.summary" class="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge v-if="job.summary.videosCompleted" variant="secondary" class="tabular-nums">
                    视频 {{ job.summary.videosCompleted }}
                  </Badge>
                  <Badge v-if="job.summary.flagsFound" variant="warning" class="tabular-nums">
                    标红 {{ job.summary.flagsFound }}
                  </Badge>
                  <span
                    v-if="!job.summary.videosCompleted && !job.summary.flagsFound"
                    class="text-muted-foreground"
                  >
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
