<script setup lang="ts">
import { computed } from "vue";
import type { EChartsOption } from "echarts";
import { useThemeStore } from "@/stores/theme";
import { VChart } from "@/lib/echarts";

const props = defineProps<{
  data: { day: string; jobs: number; errors: number; videos: number }[];
}>();

const theme = useThemeStore();

const option = computed(() => {
  const dark = theme.dark;
  const mint = dark ? "#7CF2C0" : "#1E6F52";
  const amber = dark ? "#F2B45C" : "#B27316";
  const text = dark ? "#6E8579" : "#5F7469";
  const axis = dark ? "rgba(190,235,215,0.14)" : "rgba(20,60,45,0.14)";
  const days = props.data.map((d) => d.day.slice(5));
  return {
    backgroundColor: "transparent",
    animationDuration: 520,
    animationEasing: "cubicOut",
    grid: { left: 2, right: 6, top: 16, bottom: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#111815" : "#FFFFFF",
      borderColor: dark ? "rgba(190,235,215,0.2)" : "rgba(20,60,45,0.16)",
      borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: dark ? "#E4EFE8" : "#16211B", fontSize: 11, fontFamily: "ui-monospace, monospace" },
      axisPointer: { type: "line", lineStyle: { color: axis, width: 1 } },
    },
    xAxis: {
      type: "category",
      data: days,
      boundaryGap: true,
      axisLine: { lineStyle: { color: axis } },
      axisTick: { show: false },
      axisLabel: { color: text, fontSize: 9, fontFamily: "ui-monospace, monospace", interval: 1 },
    },
    yAxis: [
      {
        type: "value",
        splitLine: { lineStyle: { color: axis, type: "dashed" } },
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      {
        type: "value",
        position: "right",
        splitLine: { show: false },
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    series: [
      {
        name: "完成视频",
        type: "bar",
        data: props.data.map((d) => d.videos),
        barWidth: 7,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: mint },
              { offset: 1, color: dark ? "rgba(124,242,192,0.14)" : "rgba(30,111,82,0.12)" },
            ],
          },
        },
      },
      {
        name: "任务数",
        type: "line",
        yAxisIndex: 1,
        data: props.data.map((d) => d.jobs),
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: amber, width: 1.4 },
        itemStyle: { color: amber },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: dark ? "rgba(242,180,92,0.22)" : "rgba(178,115,22,0.18)" },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ],
          },
        },
      },
    ],
  } as EChartsOption;
});
</script>

<template>
  <VChart :option="option" autoresize class="h-full w-full" />
</template>
