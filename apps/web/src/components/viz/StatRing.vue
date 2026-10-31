<script setup lang="ts">
import gsap from "gsap";
import { computed, onMounted, ref, watch } from "vue";

/**
 * 进度环：SVG 描边用 GSAP 补间，中心显示百分比计数。
 */
const props = withDefaults(
  defineProps<{
    value: number; // 0-100
    size?: number;
    stroke?: number;
    label?: string;
    sublabel?: string;
  }>(),
  { size: 148, stroke: 10, label: "", sublabel: "" },
);

const R = computed(() => (props.size - props.stroke) / 2);
const C = computed(() => 2 * Math.PI * R.value);

const circleRef = ref<SVGCircleElement | null>(null);
const displayPct = ref(0);
const tweenObj = { v: 0 };

function tweenTo(target: number) {
  gsap.to(tweenObj, {
    v: Math.min(100, Math.max(0, target)),
    duration: 1.1,
    ease: "power3.out",
    onUpdate: () => {
      displayPct.value = tweenObj.v;
      if (circleRef.value) {
        circleRef.value.style.strokeDashoffset = String(C.value * (1 - tweenObj.v / 100));
      }
    },
  });
}

onMounted(() => tweenTo(props.value));
watch(() => props.value, (v) => tweenTo(v));
</script>

<template>
  <div class="relative inline-flex items-center justify-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="-rotate-90">
      <circle
        :cx="size / 2" :cy="size / 2" :r="R"
        fill="none" stroke="currentColor" class="text-primary/10"
        :stroke-width="stroke"
      />
      <circle
        ref="circleRef"
        :cx="size / 2" :cy="size / 2" :r="R"
        fill="none" stroke="url(#ring-grad)"
        :stroke-width="stroke" stroke-linecap="round"
        :stroke-dasharray="C" :stroke-dashoffset="C"
      />
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#34d399" />
          <stop offset="100%" stop-color="#22d3ee" />
        </linearGradient>
      </defs>
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <span class="text-2xl font-bold tabular-nums leading-none">{{ Math.round(displayPct) }}<span class="text-sm font-medium text-muted-foreground">%</span></span>
      <span v-if="label" class="mt-1 text-xs text-muted-foreground">{{ label }}</span>
      <span v-if="sublabel" class="text-[11px] text-muted-foreground/70">{{ sublabel }}</span>
    </div>
  </div>
</template>
