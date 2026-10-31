<script setup lang="ts">
import { ChevronRight, ClipboardCheck, FileText, Film, Folder, HelpCircle } from "lucide-vue-next";
import { computed, ref } from "vue";
import type { NodeDTO } from "@/api/resources";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/utils";

const props = defineProps<{ node: NodeDTO }>();

const expanded = ref(false);
const hasChildren = computed(() => props.node.children.length > 0);

const KIND_ICONS: Record<string, typeof Film> = {
  chapter: Folder,
  video: Film,
  work: FileText,
  exam: ClipboardCheck,
};
const icon = computed(() => KIND_ICONS[props.node.kind] ?? HelpCircle);
</script>

<template>
  <div>
    <div
      class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
      :class="{ 'cursor-pointer': hasChildren }"
      @click="expanded = !expanded"
    >
      <ChevronRight
        v-if="hasChildren"
        class="size-4 shrink-0 text-muted-foreground transition-transform"
        :class="{ 'rotate-90': expanded }"
      />
      <span v-else class="size-4 shrink-0" />
      <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate text-sm">{{ node.name }}</span>
      <Badge v-if="node.completed" variant="secondary">已完成</Badge>
      <span v-else-if="node.kind === 'video'" class="text-xs tabular-nums text-muted-foreground">
        {{ Math.round(node.progress) }}% · {{ formatDuration(node.durationSeconds) }}
      </span>
    </div>
    <div v-if="expanded && hasChildren" class="ml-4 border-l pl-2">
      <CourseTreeNode v-for="child in node.children" :key="child.id" :node="child" />
    </div>
  </div>
</template>
