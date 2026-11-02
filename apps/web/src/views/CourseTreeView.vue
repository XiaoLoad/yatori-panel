<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { BookOpen, ChevronDown, ChevronRight, Play } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { api, type CourseDTO } from "@/api/resources";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import CourseTreeNode from "@/components/CourseTreeNode.vue";
import ExamSection from "@/components/ExamSection.vue";
import EmptyState from "@/components/EmptyState.vue";
import { Select } from "@/components/ui/select";
import { toastError } from "@/lib/errors";

const queryClient = useQueryClient();

const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

const accountUid = ref("");
watch(
  () => accountsQuery.data.value,
  (list) => {
    if (!accountUid.value && list?.length) accountUid.value = list[0].uid;
  },
  { immediate: true },
);

const coursesQuery = useQuery({
  queryKey: computed(() => ["courses", accountUid.value]),
  queryFn: () => api.courses(accountUid.value),
  enabled: computed(() => !!accountUid.value),
  staleTime: 60_000,
});

const selectedCourse = ref<CourseDTO | null>(null);
watch(coursesQuery.data, (list) => {
  if (selectedCourse.value && !list?.find((c) => c.id === selectedCourse.value!.id)) {
    selectedCourse.value = null;
  }
});

const treeQuery = useQuery({
  queryKey: computed(() => ["tree", accountUid.value, selectedCourse.value?.id]),
  queryFn: () => api.tree(accountUid.value, selectedCourse.value!.id),
  enabled: computed(() => !!accountUid.value && !!selectedCourse.value),
});

const listOpen = ref(true);

// 在课程卡片上直接以当前账号发起单课程任务（默认普通模式、不答题）
const startCourseMutation = useMutation({
  mutationFn: (courseId: string) =>
    api.startJob({
      accountUid: accountUid.value,
      courseIds: [courseId],
      videoMode: 1,
      answerSource: "off",
      autoSubmit: false,
      perCourseConcurrency: 4,
    }),
  onSuccess: () => {
    toast.success("任务已启动，可在任务控制台查看实时进度");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  },
  onError: (err) => toastError(err, "任务启动失败"),
});

function pick(course: CourseDTO) {
  selectedCourse.value = selectedCourse.value?.id === course.id ? null : course;
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">课程浏览</h1>
        <p class="mt-1 text-sm text-muted-foreground">每门课与每个节点的学习进度</p>
      </div>
      <Select
        v-model="accountUid"
        class="w-64"
        :options="(accountsQuery.data.value ?? []).map((a) => ({ value: a.uid, label: a.remark ? `${a.remark} · ${a.username}` : a.username }))"
        placeholder="选择账号"
      />
    </div>

    <div v-if="coursesQuery.isLoading.value" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-36 rounded-xl" />
    </div>
    <EmptyState
      v-else-if="!coursesQuery.data.value?.length"
      :icon="BookOpen"
      title="该账号暂无课程"
      description="登录检测通过后课程会出现在这里"
    />

    <div v-else class="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card class="self-start">
        <CardHeader class="flex-row items-center justify-between space-y-0 pb-3">
          <div class="space-y-1">
            <CardTitle class="text-base">课程列表</CardTitle>
            <CardDescription>{{ coursesQuery.data.value?.length ?? 0 }} 门课程</CardDescription>
          </div>
          <button class="text-muted-foreground hover:text-foreground" @click="listOpen = !listOpen">
            <component :is="listOpen ? ChevronDown : ChevronRight" class="size-4" />
          </button>
        </CardHeader>
        <CardContent v-if="listOpen" class="space-y-2.5">
          <button
            v-for="course in coursesQuery.data.value ?? []"
            :key="course.id"
            class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/60"
            :class="{ 'border-primary ring-1 ring-primary': selectedCourse?.id === course.id }"
            @click="pick(course)"
          >
            <div class="mb-2 flex items-start justify-between gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ course.name }}</span>
              <span class="shrink-0 text-sm font-semibold tabular-nums">{{ Math.round(course.progress) }}%</span>
            </div>
            <Progress :model-value="course.progress" class="h-1.5" />
            <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span class="truncate">{{ course.teacher || "-" }}</span>
              <Button
                v-if="course.progress < 100"
                variant="outline"
                size="sm"
                class="h-6 px-2 text-xs"
                :disabled="startCourseMutation.isPending.value"
                @click.stop="startCourseMutation.mutate(course.id)"
              >
                <Play class="size-3" />刷这门
              </Button>
              <span v-else>已结课</span>
            </div>
          </button>
        </CardContent>
      </Card>

      <Card class="self-start">
        <CardHeader class="pb-3">
          <CardTitle class="text-base">{{ selectedCourse?.name ?? "章节树" }}</CardTitle>
          <CardDescription>
            {{ selectedCourse ? "点击章节展开，查看每个节点的完成情况" : "在左侧选择一门课程查看详情" }}
          </CardDescription>
        </CardHeader>
        <CardContent v-if="selectedCourse" class="space-y-4">
          <div>
            <div v-if="treeQuery.isLoading.value" class="space-y-2">
              <Skeleton v-for="i in 6" :key="i" class="h-8 w-full" />
            </div>
            <div
              v-else
              class="max-h-[calc(100vh-26rem)] space-y-0.5 overflow-y-auto pr-1"
            >
              <CourseTreeNode v-for="node in treeQuery.data.value ?? []" :key="node.id" :node="node" />
            </div>
          </div>
          <ExamSection :account-uid="accountUid" :course-id="selectedCourse.id" />
        </CardContent>
      </Card>
    </div>
  </div>
</template>
