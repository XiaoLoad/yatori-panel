<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string }>();
</script>

<template>
  <div :class="cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4', props.class)">
    <slot />
  </div>
</template>
