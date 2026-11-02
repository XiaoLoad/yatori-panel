<script setup lang="ts">
const model = defineModel<boolean>({ default: false });

defineProps<{ disabled?: boolean; label?: string }>();

function onChange(e: Event) {
  model.value = (e.target as HTMLInputElement).checked;
}
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      class="size-3.5 cursor-pointer rounded border border-input accent-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
      :checked="model"
      :disabled="disabled"
      @change="onChange"
    />
    <span v-if="label" class="text-xs text-muted-foreground">{{ label }}</span>
  </label>
</template>
