import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import type { DisplayLogLevel } from "@yatori/shared";
import { api } from "@/api/resources";

export const LOG_LEVEL_RANK: Record<DisplayLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 日志级别排位：未知级别按 info 处理 */
export function logRank(level?: string): number {
  return LOG_LEVEL_RANK[(level ?? "info") as DisplayLogLevel] ?? LOG_LEVEL_RANK.info;
}

/** 设置页配置的全局日志输出档位：日志页与观测台据此过滤 */
export function useLogLevelSetting() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    staleTime: 30_000,
  });
  return computed<DisplayLogLevel>(() => query.data.value?.logLevel ?? "info");
}
