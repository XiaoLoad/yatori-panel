<script setup lang="ts">
import type { Component } from "vue";
import { Button } from "@/components/ui/button";

defineProps<{
  icon: Component;
  title: string;
  description?: string;
  actionLabel?: string;
}>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
    <div class="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <component :is="icon" class="size-5" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="mx-auto max-w-sm text-sm text-muted-foreground">{{ description }}</p>
    </div>
    <Button v-if="actionLabel" size="sm" variant="outline" @click="emit('action')">
      {{ actionLabel }}
    </Button>
  </div>
</template>
