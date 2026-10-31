<script setup lang="ts">
import { ProgressRoot, ProgressIndicator } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<{
  modelValue?: number;
  class?: string;
  indicatorClass?: string;
}>();
</script>

<template>
  <ProgressRoot
    :model-value="props.modelValue ?? 0"
    :class="cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/10', props.class)"
  >
    <ProgressIndicator
      :class="cn('h-full rounded-full bg-primary transition-all duration-500', props.indicatorClass)"
      :style="{ width: `${Math.min(100, Math.max(0, props.modelValue ?? 0))}%` }"
    />
  </ProgressRoot>
</template>
