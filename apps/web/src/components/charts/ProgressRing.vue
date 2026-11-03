<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    value: number;
    size?: number;
    stroke?: number;
    tone?: "mint" | "amber" | "ice" | "coral" | "muted" | "primary";
    showLabel?: boolean;
  }>(),
  { size: 42, stroke: 4, tone: "mint", showLabel: true },
);

const pct = computed(() => Math.min(100, Math.max(0, props.value)));
const radius = computed(() => (props.size - props.stroke) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const offset = computed(() => circumference.value * (1 - pct.value / 100));
const color = computed(() => {
  switch (props.tone) {
    case "primary":
      return "var(--primary)";
    case "amber":
      return "var(--amber)";
    case "ice":
      return "var(--ice)";
    case "coral":
      return "var(--coral)";
    case "muted":
      return "var(--muted-foreground)";
    default:
      return "var(--mint)";
  }
});
</script>

<template>
  <div
    class="relative grid shrink-0 place-items-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <svg :width="size" :height="size" class="absolute inset-0">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="var(--border)"
        :stroke-width="stroke"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="color"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
        class="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
    <span
      v-if="showLabel"
      :class="cn('mono relative text-[12.5px] font-semibold leading-none')"
      :style="{ color }"
    >{{ Math.round(pct) }}</span>
  </div>
</template>
