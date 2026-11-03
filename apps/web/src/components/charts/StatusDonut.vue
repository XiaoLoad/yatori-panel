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
    running: dark ? "#60A5FA" : "#2563EB",
    online: dark ? "#34D399" : "#059669",
    error: dark ? "#F87171" : "#DC2626",
    idle: dark ? "#3F3F46" : "#D4D4D8",
  };
  const text = dark ? "#A1A1AA" : "#71717A";
  const border = dark ? "#2A2B33" : "#E4E4E7";
  const foreground = dark ? "#F4F4F5" : "#18181B";
  return {
    backgroundColor: "transparent",
    animationDuration: 180,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#15161B" : "#FFFFFF",
      borderColor: border,
      borderWidth: 1,
      textStyle: { color: foreground, fontSize: 12 },
    },
    legend: {
      orient: "vertical",
      right: 4,
      top: "center",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 9,
      icon: "circle",
      textStyle: { color: text, fontSize: 12 },
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
        emphasis: { scale: true, scaleSize: 3 },
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
          fill: foreground,
          font: "600 18px ui-monospace, monospace",
          textAlign: "center",
        },
      },
      {
        type: "text",
        left: "27%",
        top: "57%",
        style: {
          text: "账号",
          fill: text,
          font: "12px sans-serif",
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
