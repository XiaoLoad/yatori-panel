<script setup lang="ts">
import { TabsContent, type TabsContentProps } from "reka-ui";

const props = defineProps<TabsContentProps>();
</script>

<template>
  <TabsContent v-bind="props" class="mt-4 focus-visible:outline-none">
    <slot />
  </TabsContent>
</template>
