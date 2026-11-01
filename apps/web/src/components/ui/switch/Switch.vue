<script setup lang="ts">
import { SwitchRoot, SwitchThumb, type SwitchRootProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<SwitchRootProps & { class?: string }>();
const model = defineModel<boolean>();
</script>

<template>
  <SwitchRoot
    v-model="model"
    :disabled="props.disabled"
    :class="cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      model ? 'bg-primary' : 'bg-input',
      props.class,
    )"
  >
    <SwitchThumb
      :class="cn('pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform', model ? 'translate-x-4' : 'translate-x-0')"
    />
  </SwitchRoot>
</template>
