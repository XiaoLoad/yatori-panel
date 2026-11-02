let audioCtx: AudioContext | null = null;

/**
 * 任务完成/出错提示音：两音上行（完成）/下行（出错）。
 * AudioContext 需用户手势后创建；面板内任何点击都满足。
 * 失败静默（浏览器自动播放策略限制时不打扰）。
 */
export function playJobSound(kind: "done" | "error"): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();

    const notes = kind === "done" ? [660, 880] : [440, 330];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {
    /* 自动播放被拒绝：静默 */
  }
}
