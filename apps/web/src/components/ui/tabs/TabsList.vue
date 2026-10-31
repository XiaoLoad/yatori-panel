<script setup lang="ts">
import { TabsList, TabsTrigger } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string; items: { value: string; label: string }[] }>();
</script>

<template>
  <TabsList :class="cn('inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground', props.class)">
    <TabsTrigger
      v-for="item in props.items"
      :key="item.value"
      :value="item.value"
      class="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
    >
      {{ item.label }}
    </TabsTrigger>
  </TabsList>
</template>
