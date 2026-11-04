<script setup lang="ts">
import { gsap } from "gsap";
import { onBeforeUnmount, ref, watch } from "vue";
import { useLoadingBar } from "@/lib/loading-bar";

/** 顶部全局加载条：数据请求/路由切换时显示，完成后冲到 100% 淡出 */
const { visible, progress } = useLoadingBar();
const barRef = ref<HTMLElement | null>(null);

watch(visible, (v) => {
  const el = barRef.value;
  if (!el) return;
  if (v) {
    gsap.killTweensOf(el);
    gsap.set(el, { autoAlpha: 1 });
  } else {
    gsap.killTweensOf(el);
    gsap.to(el, { autoAlpha: 0, duration: 0.25, ease: "power1.out" });
  }
});

onBeforeUnmount(() => gsap.killTweensOf(barRef.value));
</script>

<template>
  <div ref="barRef" class="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2.5px]">
    <div
      class="h-full rounded-r-full bg-gradient-to-r from-primary/60 via-primary to-primary"
      :style="{ width: `${progress}%`, transition: 'width 0.15s linear' }"
    />
  </div>
</template>
