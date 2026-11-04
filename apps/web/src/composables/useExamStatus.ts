import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import type { ExamStatusDTO } from "@/api/resources";
import { api } from "@/api/resources";

/**
 * 考试状态查询：仅英华支持，通过平台只读成绩页判断是否参加与最终得分。
 * 考试列表与结果按账号 + 课程缓存，章节树与考试标签共用同一份数据。
 */
export function useExamStatus(source: {
  accountUid: () => string;
  courseId: () => string;
  platform: () => string | undefined;
  /** 是否加载考试列表，默认加载；章节树可只在英华账号下启用 */
  enabled?: () => boolean;
}) {
  const examsQuery = useQuery({
    queryKey: computed(() => ["drawer-exams", source.accountUid(), source.courseId()]),
    queryFn: () => api.exams(source.accountUid(), source.courseId()),
    enabled: computed(() => !!source.courseId() && (source.enabled?.() ?? true)),
    staleTime: 60_000,
  });

  const examKeys = computed(() =>
    (examsQuery.data.value ?? [])
      .map((exam) => ({ examId: exam.id, nodeId: exam.extra?.nodeId ?? "" }))
      .filter((item) => item.nodeId),
  );

  const resultsQuery = useQuery({
    queryKey: computed(() => [
      "exam-results",
      source.accountUid(),
      source.courseId(),
      examKeys.value.map((item) => item.examId).join(","),
    ]),
    queryFn: () => api.examResults(source.accountUid(), source.courseId(), examKeys.value),
    // 仅英华有只读成绩页；其他平台保持「状态未知」，避免无效请求
    enabled: computed(() => source.platform() === "YINGHUA" && examKeys.value.length > 0),
    staleTime: 60_000,
    retry: 1,
  });

  const byExam = computed<Record<string, ExamStatusDTO>>(() => {
    const map: Record<string, ExamStatusDTO> = {};
    for (const item of resultsQuery.data.value ?? []) map[item.examId] = item;
    return map;
  });
  const byNode = computed<Record<string, ExamStatusDTO>>(() => {
    const map: Record<string, ExamStatusDTO> = {};
    for (const item of resultsQuery.data.value ?? []) if (item.nodeId) map[item.nodeId] = item;
    return map;
  });

  return { examsQuery, resultsQuery, examKeys, byExam, byNode };
}
