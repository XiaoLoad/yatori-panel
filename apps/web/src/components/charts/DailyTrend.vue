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
  const primary = dark ? "#60A5FA" : "#2563EB";
  const success = dark ? "#34D399" : "#059669";
  const text = dark ? "#A1A1AA" : "#71717A";
  const axis = dark ? "#2A2B33" : "#E4E4E7";
  const days = props.data.map((d) => d.day.slice(5));
  return {
    backgroundColor: "transparent",
    animationDuration: 180,
    grid: { left: 2, right: 6, top: 16, bottom: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#15161B" : "#FFFFFF",
      borderColor: axis,
      borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: dark ? "#F4F4F5" : "#18181B", fontSize: 12, fontFamily: "inherit" },
      axisPointer: { type: "line", lineStyle: { color: axis, width: 1 } },
    },
    xAxis: {
      type: "category",
      data: days,
      boundaryGap: true,
      axisLine: { lineStyle: { color: axis } },
      axisTick: { show: false },
      axisLabel: { color: text, fontSize: 12, interval: 1 },
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
        itemStyle: { borderRadius: [2, 2, 0, 0], color: primary },
      },
      {
        name: "任务数",
        type: "line",
        yAxisIndex: 1,
        data: props.data.map((d) => d.jobs),
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: success, width: 1.5 },
        itemStyle: { color: success },
      },
    ],
  } as EChartsOption;
});
</script>

<template>
  <VChart :option="option" autoresize class="h-full w-full" />
</template>
