import type { QueryClient } from "@tanstack/vue-query";
import type { JobEvent } from "@yatori/shared";

/**
 * SSE 事件 → TanStack Query 联动：
 * 任务状态/进度事件发生时使对应查询缓存失效，让列表即时刷新，
 * 各查询的 refetchInterval 轮询仅作为断线兜底（已放宽到 30s+）。
 *
 * 节流：进度事件高频（节点秒级上报），30s 窗口内只失效一次，
 * 避免每个事件都触发一次 jobs 全量重拉。
 */
const PROGRESS_INVALIDATE_WINDOW = 30_000;

export function createQuerySync(queryClient: QueryClient) {
  let lastProgressInvalidate = 0;

  return function syncFromEvent(e: JobEvent) {
    switch (e.type) {
      case "job.status":
        // 任务开始/结束/暂停：任务列表、台账、账号状态全部依赖它
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["jobs-page"] });
        void queryClient.invalidateQueries({ queryKey: ["accounts"] });
        void queryClient.invalidateQueries({ queryKey: ["running-jobs"] });
        break;
      case "task.progress": {
        // 高频事件按窗口节流，仅刷新进度相关的活跃查询
        const now = Date.now();
        if (now - lastProgressInvalidate < PROGRESS_INVALIDATE_WINDOW) return;
        lastProgressInvalidate = now;
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["jobs-page"] });
        break;
      }
      case "log":
        // 全站日志页有服务端分页查询，日志事件到达时刷新
        void queryClient.invalidateQueries({ queryKey: ["logs-page"] });
        break;
      case "gateway.status":
        void queryClient.invalidateQueries({ queryKey: ["gateway"] });
        break;
    }
  };
}
