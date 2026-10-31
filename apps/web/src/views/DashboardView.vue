<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
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

const { data } = useQuery({
  queryKey: ["dashboard"],
  queryFn: api.dashboard,
  refetchInterval: 5000,
});

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
    <div class="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>账号总数</CardDescription>
          <CardTitle class="text-3xl">{{ data?.accountCount ?? "-" }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>在线会话</CardDescription>
          <CardTitle class="text-3xl">{{ data?.onlineAccounts ?? "-" }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>运行中任务</CardDescription>
          <CardTitle class="text-3xl">{{ data?.runningJobs ?? "-" }}</CardTitle>
        </CardHeader>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>最近任务</CardTitle>
        <CardDescription>最近 5 次任务的执行情况</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead>错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="!data?.recentJobs?.length">
              <TableCell colspan="4" class="text-center text-muted-foreground">
                还没有任务，去任务控制台发起一个吧
              </TableCell>
            </TableRow>
            <TableRow v-for="job in data?.recentJobs" :key="job.id">
              <TableCell>
                <Badge :variant="stateBadge(job.state).variant">
                  {{ stateBadge(job.state).text }}
                </Badge>
              </TableCell>
              <TableCell>{{ new Date(job.startedAt).toLocaleString() }}</TableCell>
              <TableCell class="text-muted-foreground">
                <template v-if="job.summary">
                  视频 {{ job.summary.videosCompleted }} · 标红 {{ job.summary.flagsFound }} ·
                  作业 {{ job.summary.worksDone }} · 考试 {{ job.summary.examsDone }}
                </template>
                <template v-else>-</template>
              </TableCell>
              <TableCell class="max-w-72 truncate text-red-500">
                {{ job.summary?.errors?.join("；") || "-" }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div class="mt-4">
          <Button variant="outline" as-child>
            <RouterLink to="/jobs">前往任务控制台</RouterLink>
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
