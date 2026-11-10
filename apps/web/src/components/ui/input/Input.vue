<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: string; modelValue?: string | number; type?: string; placeholder?: string; disabled?: boolean; required?: boolean; /** 掩码显示（圆点）：用 CSS 实现而非 type=password，避免触发浏览器保存密码提示 */ masked?: boolean; /** 失焦时自动去除首尾空格；密码与日期/数字/文件类默认不处理 */ trim?: boolean }>();
const model = defineModel<string | number>();

/** 密码可能本身含首尾空格，日期/数字/文件类没有空白语义，均不自动裁剪 */
const NO_TRIM_TYPES = new Set(["password", "number", "date", "time", "file"]);
const shouldTrim = computed(() => props.trim ?? !NO_TRIM_TYPES.has(props.type ?? "text"));

/** 失焦是「输入完成」的自然信号；回车提交不会触发失焦，调用方仍需在提交时兜底裁剪 */
function onBlur() {
  if (!shouldTrim.value || typeof model.value !== "string") return;
  const next = model.value.trim();
  if (next !== model.value) model.value = next;
}
</script>

<template>
  <input
    v-model="model"
    :type="props.type ?? 'text'"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :required="props.required"
    @blur="onBlur"
    :class="cn(
      'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
    :style="masked ? ({ WebkitTextSecurity: 'disc' } as Record<string, string>) : undefined"
  />
</template>
