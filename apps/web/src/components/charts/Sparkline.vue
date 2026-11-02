<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  values: number[];
  color?: string;
  height?: number;
}>();

const points = computed(() => {
  const vs = props.values.length ? props.values : [0];
  const max = Math.max(...vs, 1);
  const min = Math.min(...vs, 0);
  const span = max - min || 1;
  const step = 100 / Math.max(1, vs.length - 1);
  return vs
    .map((v, i) => `${(i * step).toFixed(1)},${(26 - ((v - min) / span) * 22).toFixed(1)}`)
    .join(" ");
});

const lastPoint = computed(() => {
  const parts = points.value.split(" ").pop()?.split(",") ?? ["0", "0"];
  return { x: Number(parts[0]), y: Number(parts[1]) };
});
</script>

<template>
  <svg viewBox="0 0 100 28" :style="{ height: `${height ?? 26}px` }" class="w-full" preserveAspectRatio="none">
    <polyline
      :points="points"
      fill="none"
      :stroke="color ?? 'var(--mint)'"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
      opacity="0.9"
    />
    <circle :cx="lastPoint.x" :cy="lastPoint.y" r="1.6" :fill="color ?? 'var(--mint)'" />
  </svg>
</template>
