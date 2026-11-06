<script setup lang="ts">
import { Check, Minus } from "lucide-vue-next";
import { cn } from "@/lib/utils";

const model = defineModel<boolean>({ default: false });

const props = defineProps<{ disabled?: boolean; label?: string; indeterminate?: boolean }>();

function onChange(e: Event) {
  model.value = (e.target as HTMLInputElement).checked;
}
</script>

<template>
  <label
    :class="cn(
      'group/checkbox inline-flex select-none items-center gap-2',
      props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
    )"
  >
    <input
      type="checkbox"
      class="peer sr-only"
      :checked="model"
      :indeterminate="props.indeterminate ?? undefined"
      :disabled="props.disabled"
      @change="onChange"
    />
    <span
      :class="cn(
        'grid size-[17px] shrink-0 place-items-center rounded-[5px] border transition-all duration-150',
        'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card',
        model || props.indeterminate
          ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_14%,transparent)]'
          : 'border-input bg-card text-transparent hover:border-primary/50 hover:bg-primary/5',
      )"
    >
      <Minus v-if="props.indeterminate" class="size-3" :stroke-width="2.8" />
      <Check v-else class="size-3" :stroke-width="2.8" />
    </span>
    <span v-if="label" class="text-[13px] text-muted-foreground">{{ label }}</span>
  </label>
</template>
