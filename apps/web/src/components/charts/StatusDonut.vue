<script setup lang="ts">
import { computed } from "vue";
import type { EChartsOption } from "echarts";
import { useThemeStore } from "@/stores/theme";
import { VChart } from "@/lib/echarts";

const props = defineProps<{
  counts: { running: number; online: number; error: number; idle: number };
}>();

const theme = useThemeStore();

const total = computed(
  () => props.counts.running + props.counts.online + props.counts.error + props.counts.idle,
);

const option = computed(() => {
  const dark = theme.dark;
  const colors = {
    running: dark ? "#7CF2C0" : "#1E6F52",
    online: dark ? "#8AD8F0" : "#22708C",
    error: dark ? "#F07167" : "#B8433B",
    idle: dark ? "#3B4A43" : "#C9D3CC",
  };
  return {
    backgroundColor: "transparent",
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#111815" : "#FFFFFF",
      borderColor: dark ? "rgba(190,235,215,0.2)" : "rgba(20,60,45,0.16)",
      borderWidth: 1,
      textStyle: { color: dark ? "#E4EFE8" : "#16211B", fontSize: 13 },
    },
    legend: {
      orient: "vertical",
      right: 4,
      top: "center",
      itemWidth: 6,
      itemHeight: 6,
      itemGap: 9,
      icon: "circle",
      textStyle: {
        color: dark ? "#A9BFB4" : "#4C5F55",
        fontSize: 12.5,
        fontFamily: "ui-monospace, monospace",
      },
      formatter: (name: string) => {
        const map: Record<string, number> = {
          运行中: props.counts.running,
          在线待机: props.counts.online,
          异常: props.counts.error,
          待登录: props.counts.idle,
        };
        return ` ${name}  ${map[name] ?? 0}`;
      },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        center: ["34%", "50%"],
        avoidLabelOverlap: false,
        itemStyle: { borderColor: "transparent", borderWidth: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 4 },
        data: [
          { name: "运行中", value: props.counts.running, itemStyle: { color: colors.running } },
          { name: "在线待机", value: props.counts.online, itemStyle: { color: colors.online } },
          { name: "异常", value: props.counts.error, itemStyle: { color: colors.error } },
          { name: "待登录", value: props.counts.idle, itemStyle: { color: colors.idle } },
        ].filter((d) => d.value > 0),
      },
    ],
    graphic: [
      {
        type: "text",
        left: "27%",
        top: "42%",
        style: {
          text: String(total.value),
          fill: dark ? "#E4EFE8" : "#16211B",
          font: "600 18px ui-monospace, monospace",
          textAlign: "center",
        },
      },
      {
        type: "text",
        left: "27%",
        top: "56%",
        style: {
          text: "ACCOUNTS",
          fill: dark ? "#9CB3A7" : "#4C5F55",
          font: "11px ui-monospace, monospace",
          textAlign: "center",
        },
      },
    ],
  } as EChartsOption;
});
</script>

<template>
  <VChart :option="option" autoresize class="h-full w-full" />
</template>
