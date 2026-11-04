import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import type { WorkStatusDTO } from "@/api/resources";
import { api } from "@/api/resources";

/**
 * 作业状态查询：仅英华支持，通过平台只读作业详情页判断是否已提交与最高分。
 * 作业列表与结果按账号 + 课程缓存，作业标签内共用同一份数据。
 */
export function useWorkStatus(source: {
  accountUid: () => string;
  courseId: () => string;
  platform: () => string | undefined;
  enabled?: () => boolean;
}) {
  const worksQuery = useQuery({
    queryKey: computed(() => ["drawer-works", source.accountUid(), source.courseId()]),
    queryFn: () => api.works(source.accountUid(), source.courseId()),
    enabled: computed(() => !!source.courseId() && (source.enabled?.() ?? true)),
    staleTime: 60_000,
  });

  const workKeys = computed(() =>
    (worksQuery.data.value ?? [])
      .map((work) => ({ workId: work.id, nodeId: work.extra?.nodeId ?? "" }))
      .filter((item) => item.nodeId),
  );

  const resultsQuery = useQuery({
    queryKey: computed(() => [
      "work-results",
      source.accountUid(),
      source.courseId(),
      workKeys.value.map((item) => item.workId).join(","),
    ]),
    queryFn: () => api.workResults(source.accountUid(), source.courseId(), workKeys.value),
    // 仅英华有只读成绩页；其他平台保持「状态未知」，避免无效请求
    enabled: computed(() => source.platform() === "YINGHUA" && workKeys.value.length > 0),
    staleTime: 60_000,
    retry: 1,
  });

  const byWork = computed<Record<string, WorkStatusDTO>>(() => {
    const map: Record<string, WorkStatusDTO> = {};
    for (const item of resultsQuery.data.value ?? []) map[item.workId] = item;
    return map;
  });

  return { worksQuery, resultsQuery, workKeys, byWork };
}
