<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "reka-ui";
import { ChevronDown } from "lucide-vue-next";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  class?: string;
}>();
const model = defineModel<string>();
</script>

<template>
  <SelectRoot v-model="model">
    <SelectTrigger
      :disabled="props.disabled"
      :class="cn(
        'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )"
    >
      <SelectValue :placeholder="props.placeholder ?? '请选择'" />
      <ChevronDown class="size-4 opacity-50" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :body-lock="false"
        class="z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      >
        <SelectItem
          v-for="opt in props.options"
          :key="opt.value"
          :value="opt.value"
          :disabled="opt.disabled"
          class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-3 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
        >
          <SelectItemText>{{ opt.label }}</SelectItemText>
        </SelectItem>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
