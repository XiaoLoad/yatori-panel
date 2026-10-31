<script setup lang="ts">
import { DialogClose } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string }>();
</script>

<template>
  <DialogClose :class="cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', props.class)">
    <slot />
  </DialogClose>
</template>
