<script setup lang="ts">
import gsap from "gsap";
import { onMounted, ref, watch } from "vue";

/**
 * 数字滚动计数器：值变化时用 GSAP 补间到新值。
 */
const props = withDefaults(
  defineProps<{ value: number; duration?: number; decimals?: number }>(),
  { duration: 0.9, decimals: 0 },
);

const display = ref("0");
const counter = ref(0);

function tweenTo(target: number) {
  const obj = { v: counter.value };
  gsap.to(obj, {
    v: target,
    duration: props.duration,
    ease: "power3.out",
    onUpdate: () => {
      counter.value = obj.v;
      display.value = obj.v.toFixed(props.decimals);
    },
  });
}

onMounted(() => tweenTo(props.value));
watch(
  () => props.value,
  (v) => tweenTo(v),
);
</script>

<template>
  <span class="tabular-nums">{{ display }}</span>
</template>
