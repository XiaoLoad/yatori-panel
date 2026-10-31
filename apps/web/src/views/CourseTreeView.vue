<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { ChevronDown, ChevronRight } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { api, type CourseDTO } from "@/api/resources";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CourseTreeNode from "@/components/CourseTreeNode.vue";
import { Select } from "@/components/ui/select";

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
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <Select
        v-model="accountUid"
        class="max-w-xs"
        :options="(accountsQuery.data.value ?? []).map((a) => ({ value: a.uid, label: `${a.platformName} · ${a.username}` }))"
        placeholder="选择账号"
      />
    </div>

    <div class="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <button
            class="flex w-full items-center gap-1.5 text-left"
            @click="listOpen = !listOpen"
          >
            <component :is="listOpen ? ChevronDown : ChevronRight" class="size-4" />
            <CardTitle class="text-base">课程列表</CardTitle>
          </button>
          <CardDescription>{{ coursesQuery.data.value?.length ?? 0 }} 门课程</CardDescription>
        </CardHeader>
        <CardContent v-if="listOpen" class="space-y-3">
          <div v-if="coursesQuery.isLoading.value" class="text-sm text-muted-foreground">
            加载中…
          </div>
          <button
            v-for="course in coursesQuery.data.value ?? []"
            :key="course.id"
            class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/60"
            :class="{ 'border-primary': selectedCourse?.id === course.id }"
            @click="selectedCourse = course"
          >
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-sm font-medium">{{ course.name }}</span>
              <span class="text-xs tabular-nums text-muted-foreground">
                {{ Math.round(course.progress) }}%
              </span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all"
                :style="{ width: `${Math.min(100, course.progress)}%` }"
              />
            </div>
            <div class="mt-1.5 text-xs text-muted-foreground">{{ course.teacher || "-" }}</div>
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            {{ selectedCourse?.name ?? "章节树" }}
          </CardTitle>
          <CardDescription>
            {{ selectedCourse ? "点击章节展开，查看各节点完成情况" : "先在左侧选择一门课程" }}
          </CardDescription>
        </CardHeader>
        <CardContent v-if="selectedCourse">
          <div v-if="treeQuery.isLoading.value" class="text-sm text-muted-foreground">
            加载中…
          </div>
          <div v-else class="space-y-0.5">
            <CourseTreeNode v-for="node in treeQuery.data.value ?? []" :key="node.id" :node="node" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
