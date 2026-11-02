<script setup lang="ts">
import { use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import VChart from "vue-echarts";
import { computed } from "vue";
import { useThemeStore } from "@/stores/theme";

use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface DailyStat {
  day: string;
  jobs: number;
  errors: number;
  videos: number;
}

const props = defineProps<{ items: DailyStat[]; height?: number }>();
const theme = useThemeStore();

const isDark = computed(() => theme.dark);
const axisColor = computed(() => (isDark.value ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)"));
const splitColor = computed(() => (isDark.value ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"));

const option = computed(() => ({
  grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
  legend: {
    top: 0,
    textStyle: { color: axisColor.value, fontSize: 11 },
    itemWidth: 12,
    itemHeight: 8,
  },
  tooltip: { trigger: "axis" },
  xAxis: {
    type: "category",
    data: props.items.map((i) => i.day.slice(5)), // MM-DD
    axisLabel: { color: axisColor.value, fontSize: 11 },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: splitColor.value } },
  },
  yAxis: [
    { type: "value", name: "视频", axisLabel: { color: axisColor.value }, splitLine: { lineStyle: { color: splitColor.value } } },
    { type: "value", name: "任务", axisLabel: { color: axisColor.value }, splitLine: { show: false } },
  ],
  series: [
    {
      name: "完成视频",
      type: "bar",
      data: props.items.map((i) => i.videos),
      barMaxWidth: 18,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "#34d399" },
            { offset: 1, color: "#22d3ee" },
          ],
        },
      },
    },
    {
      name: "任务数",
      type: "line",
      yAxisIndex: 1,
      data: props.items.map((i) => i.jobs),
      smooth: true,
      symbol: "circle",
      symbolSize: 5,
      lineStyle: { width: 2, color: "#a78bfa" },
      itemStyle: { color: "#a78bfa" },
    },
  ],
}));
</script>

<template>
  <VChart
    :option="option"
    :style="{ height: `${height ?? 240}px`, width: '100%' }"
    autoresize
  />
</template>
