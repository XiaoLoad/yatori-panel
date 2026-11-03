<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string }>();
</script>

<template>
  <div
    :class="cn(
      'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-6 py-3.5 sm:flex-row sm:justify-end',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
