import { onBeforeUnmount, onMounted } from "vue";
import type { JobEvent } from "@yatori/shared";
import { useQueryClient } from "@tanstack/vue-query";
import { useEventStore } from "@/stores/events";
import { createQuerySync } from "@/lib/query-sync";

// 全局单例 SSE：面板所有实时数据（进度/日志/状态）都来自这一条流。
// EventSource 自带断线重连，这里只负责接入与分发。
let source: EventSource | null = null;

export function useEventStream() {
  const store = useEventStore();
  const queryClient = useQueryClient();
  const syncFromEvent = createQuerySync(queryClient);

  function handle(e: MessageEvent) {
    try {
      const event = JSON.parse(e.data) as JobEvent;
      store.ingest(event);
      syncFromEvent(event);
    } catch {
      // 忽略不完整帧
    }
  }

  onMounted(() => {
    if (source) return;
    source = new EventSource("/api/v1/events/stream");
    source.onopen = () => {
      store.connected = true;
    };
    source.onerror = () => {
      store.connected = false;
    };
    source.onmessage = handle;
  });

  onBeforeUnmount(() => {
    // 布局组件销毁 = 整个面板退出；保留单例由页面刷新兜底
  });
}
