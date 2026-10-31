<script setup lang="ts">
import { use } from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import VChart from "vue-echarts";
import { computed, ref, watch } from "vue";
import gsap from "gsap";
import { useThemeStore } from "@/stores/theme";

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface CourseBar {
  name: string;
  progress: number; // 0-100
  done?: number; // 可选：完成节点数
  total?: number; // 可选：总节点数
}

const props = defineProps<{ items: CourseBar[]; height?: number }>();
const theme = useThemeStore();
const pending = ref(false);

// 进度值变化时补间而非跳变
const tweenItems = ref<CourseBar[]>([]);
watch(
  () => props.items,
  (next) => {
    if (pending.value) return;
    pending.value = true;
    const source = next.map((i) => ({ ...i, progress: 0 }));
    tweenItems.value = source;
    gsap.to(source, {
      duration: 1,
      ease: "power3.out",
      progress: (i: number) => next[i].progress,
      onUpdate: () => {
        tweenItems.value = source.map((s) => ({ ...s }));
      },
      onComplete: () => {
        pending.value = false;
      },
    });
  },
  { immediate: true, deep: false },
);

const isDark = computed(() => theme.dark);
const axisColor = computed(() => (isDark.value ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)"));
const splitColor = computed(() => (isDark.value ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"));

const option = computed(() => ({
  grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
  xAxis: {
    type: "value",
    max: 100,
    axisLabel: { color: axisColor.value, formatter: "{value}%" },
    splitLine: { lineStyle: { color: splitColor.value } },
  },
  yAxis: {
    type: "category",
    data: tweenItems.value.map((i) => i.name),
    axisLabel: {
      color: axisColor.value,
      width: 130,
      overflow: "truncate",
      fontSize: 12,
    },
    axisTick: { show: false },
    axisLine: { show: false },
  },
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "shadow" },
    formatter: (params: unknown) => {
      const p = (params as { name: string; value: number; dataIndex: number }[])[0];
      const it = tweenItems.value[p.dataIndex];
      const nodes = it.total ? `<br/>节点 ${it.done}/${it.total}` : "";
      return `${p.name}<br/>进度 ${Math.round(p.value)}%${nodes}`;
    },
  },
  series: [
    {
      type: "bar",
      data: tweenItems.value.map((i) => Math.round(i.progress * 10) / 10),
      barWidth: 10,
      itemStyle: {
        borderRadius: 5,
        color: {
          type: "linear", x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [
            { offset: 0, color: "#34d399" },
            { offset: 1, color: "#22d3ee" },
          ],
        },
      },
      backgroundStyle: { color: "rgba(128,128,128,0.12)", borderRadius: 5 },
      label: {
        show: true,
        position: "right",
        formatter: "{c}%",
        color: axisColor.value,
        fontSize: 11,
      },
    },
  ],
}));
</script>

<template>
  <VChart
    :option="option"
    :style="{ height: `${height ?? items.length * 36 + 40}px`, width: '100%' }"
    autoresize
  />
</template>
