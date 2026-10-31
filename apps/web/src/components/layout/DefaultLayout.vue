<script setup lang="ts">
import gsap from "gsap";
import { nextTick, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import SidebarNav from "./SidebarNav.vue";
import HeaderBar from "./HeaderBar.vue";

const mainRef = ref<HTMLElement | null>(null);
const route = useRoute();

// 路由切换：主区一次性的淡入上升；prefers-reduced-motion 时跳过
watch(
  () => route.path,
  async () => {
    await nextTick();
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(mainRef.value, {
        y: 14,
        autoAlpha: 0,
        duration: 0.4,
        ease: "power2.out",
        clearProps: "all",
      });
    });
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-screen">
    <SidebarNav />
    <div class="flex min-w-0 flex-1 flex-col">
      <HeaderBar />
      <main ref="mainRef" class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
