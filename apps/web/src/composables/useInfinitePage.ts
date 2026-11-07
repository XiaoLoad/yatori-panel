import { useInfiniteQuery } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * 移动端无限滚动：基于服务端 page/pageSize 分页接口，滚到底部自动加载下一页。
 * - 桌面端继续用传统的 page 翻页（useQuery），两端共享同一后端接口；
 * - IntersectionObserver 哨兵元素放在列表末尾，rootMargin 提前 400px 预取；
 * - 筛选条件变化时 infinite query 的 key 变化，自动从第一页重新累积。
 */
export function useInfinitePage<T>(options: {
  /** 查询 key 前缀 */
  key: string;
  /** 响应式筛选对象（不含 page），同时参与 queryKey */
  filters: Ref<Record<string, unknown>>;
  pageSize?: number;
  fetch: (filters: Record<string, unknown>, page: number, pageSize: number) => Promise<{ items: T[]; total: number }>;
}) {
  const pageSize = options.pageSize ?? 20;

  const query = useInfiniteQuery({
    // 用 getter 返回完整 key：filters 变化即换 key，TanStack 自动重置累积页；
    // 浅拷贝保证 key 是普通对象（绕开 DeepUnwrapRef 对泛型 Ref 的嵌套推断）
    queryKey: computed(() => [options.key, "infinite", { ...options.filters.value }] as const),
    queryFn: ({ pageParam }) => options.fetch(options.filters.value, pageParam as number, pageSize),
    initialPageParam: 1,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return loaded < last.total ? allPages.length + 1 : undefined;
    },
    // 断线兜底；SSE 推送仍负责实时失效
    refetchInterval: 60_000,
  });

  /** 已累积的全部条目（按页顺序拼接） */
  const items = computed<T[]>(() => (query.data.value?.pages.flatMap((p) => p.items) ?? []) as T[]);
  const total = computed(() => query.data.value?.pages.at(-1)?.total ?? 0);
  const hasMore = computed(() => query.hasNextPage.value);
  /** 初次加载 */
  const initialLoading = computed(() => query.isLoading.value);
  /** 加载更多中（非首页） */
  const loadingMore = computed(() => query.isFetchingNextPage.value);

  function loadMore() {
    if (query.hasNextPage.value && !query.isFetchingNextPage.value) {
      void query.fetchNextPage();
    }
  }

  // ---------- 哨兵观察 ----------
  const sentinel = ref<HTMLElement | null>(null);
  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "400px" },
    );
    if (sentinel.value) observer.observe(sentinel.value);
  });
  onBeforeUnmount(() => observer?.disconnect());

  return { query, items, total, hasMore, initialLoading, loadingMore, loadMore, sentinel };
}

/** 响应式判断是否为移动端视口（<md 768px），与 BottomNav 断点一致 */
export function useIsMobile(): Ref<boolean> {
  const mobile = ref(typeof window !== "undefined" && window.innerWidth < 768);
  const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 767.98px)") : null;
  if (mq) {
    const onChange = (e: MediaQueryListEvent) => {
      mobile.value = e.matches;
    };
    mq.addEventListener("change", onChange);
    onBeforeUnmount(() => mq.removeEventListener("change", onChange));
  }
  return mobile;
}
