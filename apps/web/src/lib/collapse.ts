import { gsap } from "gsap";

/** 尊重系统「减弱动态效果」设置：开启时所有折叠过场直接跳过 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 折叠展开过场：高度 + 透明度（GSAP），用于条件渲染区块避免生硬顶开。
 * fast 用于小尺寸组件；reduced-motion 用户直接完成。
 */
export function animateCollapse(el: Element, dir: "enter" | "leave", done: () => void, fast = false): void {
  if (prefersReducedMotion()) {
    done();
    return;
  }
  if (dir === "enter") {
    gsap.fromTo(
      el,
      { height: 0, autoAlpha: 0, overflow: "hidden" },
      {
        height: "auto",
        autoAlpha: 1,
        duration: fast ? 0.24 : 0.32,
        ease: "power2.out",
        clearProps: "height,overflow,transform,visibility",
        onComplete: done,
      },
    );
  } else {
    gsap.to(el, {
      height: 0,
      autoAlpha: 0,
      overflow: "hidden",
      duration: fast ? 0.16 : 0.22,
      ease: "power1.in",
      onComplete: done,
    });
  }
}
