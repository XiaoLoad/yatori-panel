<script setup lang="ts">
import { TabsRoot, type TabsRootProps } from "reka-ui";

const props = defineProps<TabsRootProps>();
</script>

<template>
  <TabsRoot v-bind="props">
    <slot />
  </TabsRoot>
</template>
