<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string; modelValue?: string | number; type?: string; placeholder?: string; disabled?: boolean; required?: boolean; /** 掩码显示（圆点）：用 CSS 实现而非 type=password，避免触发浏览器保存密码提示 */ masked?: boolean }>();
const model = defineModel<string | number>();
</script>

<template>
  <input
    v-model="model"
    :type="props.type ?? 'text'"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :required="props.required"
    :class="cn(
      'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
    :style="masked ? ({ WebkitTextSecurity: 'disc' } as Record<string, string>) : undefined"
  />
</template>
