<script setup lang="ts">
import { RouterView } from "vue-router";
import { onBeforeUnmount } from "vue";
import { gsap } from "gsap";
import TopBar from "./TopBar.vue";
import { useEventStream } from "@/composables/useEventStream";

useEventStream();

let timeline: gsap.core.Timeline | null = null;
let enterDone: (() => void) | null = null;

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function finishEnter() {
  enterDone?.();
  enterDone = null;
}

/** 页面进入：整页轻移 + 区块错峰上浮，形成有层次的切换动效 */
function onEnter(el: Element, done: () => void) {
  enterDone = done;
  if (reduceMotion()) {
    finishEnter();
    return;
  }
  const root = el as HTMLElement;
  const stage = root.firstElementChild as HTMLElement | null;
  const blocks = stage ? Array.from(stage.children) : [];

  timeline?.kill();
  timeline = gsap.timeline({ onComplete: finishEnter });
  timeline
    .fromTo(
      root,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out", clearProps: "transform,opacity,visibility" },
    )
    .fromTo(
      blocks,
      { autoAlpha: 0, y: 20, scale: 0.995 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.5,
        stagger: 0.055,
        ease: "power3.out",
        clearProps: "transform,opacity,visibility",
      },
      0.03,
    );
}

/** 页面离开：快速淡出，交给 out-in 切换 */
function onLeave(el: Element, done: () => void) {
  // 若进入动画尚未结束，先释放进入回调，避免过渡卡住
  finishEnter();
  timeline?.kill();
  timeline = null;
  if (reduceMotion()) {
    done();
    return;
  }
  gsap.to(el, {
    autoAlpha: 0,
    y: -10,
    duration: 0.18,
    ease: "power2.in",
    clearProps: "transform,opacity,visibility",
    onComplete: done,
  });
}

onBeforeUnmount(() => {
  timeline?.kill();
  timeline = null;
});
</script>

<template>
  <div class="relative min-h-screen">
    <TopBar />
    <main class="mx-auto w-full max-w-[1480px] px-4 pb-20 pt-6 md:px-8">
      <RouterView v-slot="{ Component, route }">
        <Transition :css="false" mode="out-in" @enter="onEnter" @leave="onLeave">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
