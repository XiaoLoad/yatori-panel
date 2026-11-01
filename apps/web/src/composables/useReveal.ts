import { onBeforeUnmount, onMounted } from "vue";
import gsap from "gsap";

/**
 * 页面入场编排：stagger 上升浮现。
 * 一次性动画；prefers-reduced-motion 时直接跳过。
 * 用法：容器 ref 传进来，内部带 .reveal 类的元素按序入场。
 */
export function useReveal(rootRef: () => HTMLElement | null, selector = ".reveal") {
  let mm: gsap.MatchMedia | null = null;

  onMounted(() => {
    const el = rootRef();
    if (!el) return;
    mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(el.querySelectorAll(selector), {
        y: 18,
        autoAlpha: 0,
        duration: 0.55,
        ease: "power3.out",
        stagger: 0.07,
        clearProps: "transform,opacity,visibility",
      });
    });
  });

  onBeforeUnmount(() => {
    mm?.revert();
    mm = null;
  });
}
