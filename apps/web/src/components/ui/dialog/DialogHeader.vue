<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string }>();
</script>

<template>
  <div :class="cn('shrink-0 space-y-1 border-b border-border px-6 pb-4 pr-14 pt-5', props.class)">
    <slot />
  </div>
</template>
