<script setup lang="ts">
import { RouterView } from "vue-router";
import { onBeforeUnmount } from "vue";
import { gsap } from "gsap";
import TopBar from "./TopBar.vue";
import BottomNav from "./BottomNav.vue";
import { useEventStream } from "@/composables/useEventStream";
import { isViewTransitionActive } from "@/lib/view-transition";

useEventStream();

let timeline: gsap.core.Timeline | null = null;
let enterDone: (() => void) | null = null;

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * VT 导航不走 Vue Transition 的 out-in 排队：out-in 会把新组件挂载
 * 推迟到 leave 完成之后，而 VT 的 update 回调需要导航与 DOM 更新
 * 在同一次回调内完成，排队会让 VT 新快照拍不到新页面 → 动画丢失。
 * VT 期间改为默认 mode（同时进出），页面切换动画完全由 VT 快照承担。
 * 注意：vtActive 是普通变量（非响应式），必须用函数调用（每次渲染
 * 重新求值）而非 computed（依赖不变会命中缓存返回旧值）。
 */
function transitionMode(): "default" | "out-in" {
  return isViewTransitionActive() ? "default" : "out-in";
}

function finishEnter() {
  enterDone?.();
  enterDone = null;
}

/** 页面进入：整页轻移 + 区块错峰上浮，形成有层次的切换动效 */
function onEnter(el: Element, done: () => void) {
  enterDone = done;
  // VT 共享元素过渡接管本次页面切换：跳过 GSAP 编排避免双层动画竞争
  // （VT 会把 view-transition-name 元素提升到根层渲染快照，叠加 GSAP 会闪烁）
  if (isViewTransitionActive()) {
    finishEnter();
    return;
  }
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
  // VT 接管：真实 DOM 立即离场（同步 done），VT 快照负责全部视觉过渡。
  // 默认 mode 下新旧组件共存，此时同步移除旧组件不会触发
  // afterLeave 二次移除（该问题只在 out-in 的延迟卸载中出现）
  if (isViewTransitionActive()) {
    done();
    return;
  }
  // 非 VT 路径（含 reduced-motion）：reduced-motion 异步释放避免
  // afterLeave 对已卸载元素二次移除（parentNode null 报错）
  if (reduceMotion()) {
    requestAnimationFrame(() => done());
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
    <!-- pb 末段给移动端底部标签栏留位（md 以下），含 iOS 安全区 -->
    <main class="mx-auto w-full max-w-[1480px] px-4 pb-[calc(72px+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-20">
      <RouterView v-slot="{ Component, route }">
        <Transition :css="false" :mode="transitionMode()" @enter="onEnter" @leave="onLeave">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>
    <BottomNav />
  </div>
</template>
