import { nextTick, onBeforeUnmount, onMounted } from "vue";
import gsap from "gsap";

/**
 * 页面入场编排：stagger 上升浮现。
 * 一次性动画；prefers-reduced-motion 时直接跳过。
 * 用法：容器 ref 传进来，内部带 .reveal 类的元素按序入场。
 *
 * 竞态保护：gsap.from 会在动画期间给元素写 visibility/opacity 内联样式，
 * 若切页发生在动画中途，Vue 卸载这些节点时会因 GSAP 残留引用/样式触发
 * "Cannot read properties of null (reading 'parentNode')"。因此：
 *  1. 用 gsap.context(scope) 管理所有 tween，卸载时 revert 清理；
 *  2. nextTick 后快照元素集合（数组）再动画，避免动画期间新增/移除节点
 *     被 selector 重复命中；
 *  3. 卸载前 killTweensOf + clearProps，确保交还 DOM 时无内联样式残留。
 */
export function useReveal(rootRef: () => HTMLElement | null, selector = ".reveal") {
  let ctx: gsap.Context | null = null;
  let targets: HTMLElement[] = [];

  onMounted(() => {
    void nextTick(() => {
      const el = rootRef();
      if (!el) return;
      targets = Array.from(el.querySelectorAll<HTMLElement>(selector));
      if (!targets.length) return;

      ctx = gsap.context(() => {
        gsap.fromTo(
          targets,
          { y: 18, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.55,
            ease: "power3.out",
            stagger: 0.07,
            clearProps: "transform,opacity,visibility",
          },
        );
      }, el);
    });
  });

  onBeforeUnmount(() => {
    // 中途切页：先终止进行中的 tween 并清掉内联样式，再把 DOM 交还给 Vue 卸载
    gsap.killTweensOf(targets);
    for (const t of targets) {
      t.style.removeProperty("transform");
      t.style.removeProperty("opacity");
      t.style.removeProperty("visibility");
    }
    targets = [];
    ctx?.revert();
    ctx = null;
  });
}
