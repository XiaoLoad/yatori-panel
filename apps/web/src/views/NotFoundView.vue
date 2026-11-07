<script setup lang="ts">
import { Compass, House } from "lucide-vue-next";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";

const route = useRoute();
</script>

<template>
  <div class="relative grid min-h-[calc(100vh-8rem)] place-items-center overflow-hidden px-6">
    <!-- 背景氛围：大号 mono 404 作纹理，蓝点呼吸作信号感 -->
    <span
      class="mono pointer-events-none absolute -top-6 select-none text-[240px] leading-none font-semibold tracking-tighter text-foreground/[0.035] md:text-[320px]"
      aria-hidden="true"
    >404</span>
    <span class="pointer-events-none absolute inset-0" aria-hidden="true">
      <span class="absolute left-1/4 top-1/3 size-1.5 animate-breathe rounded-full bg-primary/50" />
      <span class="absolute right-1/4 top-1/2 size-1 animate-breathe rounded-full bg-primary/30 [animation-delay:0.6s]" />
      <span class="absolute bottom-1/4 left-1/2 size-1 animate-breathe rounded-full bg-primary/40 [animation-delay:1.2s]" />
    </span>

    <div class="relative max-w-[460px] text-center">
      <div class="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-card shadow-sm">
        <Compass class="size-5 text-primary" />
      </div>

      <p class="mono mt-6 text-[12.5px] tracking-wide text-muted-foreground">ROUTE NOT FOUND · 404</p>
      <h1 class="display-title mt-2 text-[24px] leading-none">这条路由不存在</h1>
      <p class="mt-3 text-[14px] leading-6 text-muted-foreground">
        地址栏的路径没有对应任何页面，可能已被移动或从未存在。
        <br class="hidden sm:block" />
        <span class="mono text-[12px]">当前路径：{{ route.fullPath }}</span>
      </p>

      <div class="mt-7 flex items-center justify-center gap-2">
        <Button class="h-9 gap-1.5 text-[13.5px]" @click="$router.push('/')">
          <House class="size-3.5" />回到观测台
        </Button>
        <Button variant="outline" class="h-9 text-[13.5px]" @click="$router.back()">返回上一页</Button>
      </div>
    </div>
  </div>
</template>
