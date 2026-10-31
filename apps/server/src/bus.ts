import type { JobEvent } from "./shared.ts";

interface Subscriber {
  id: number;
  accountId?: string;
  jobId?: string;
  send: (e: JobEvent) => void;
}

/**
 * 进程内事件总线：任务运行器发布 → SSE 订阅者消费。
 * 纯内存扇出；需要持久化的事件（job.status / task.flag）由写入方自行落库。
 */
class Bus {
  private seq = 0;
  private subs = new Map<number, Subscriber>();

  subscribe(
    filter: { accountId?: string; jobId?: string },
    send: (e: JobEvent) => void,
  ): () => void {
    const id = ++this.seq;
    this.subs.set(id, { id, ...filter, send });
    return () => {
      this.subs.delete(id);
    };
  }

  publish(e: JobEvent): void {
    for (const sub of this.subs.values()) {
      if (sub.jobId) {
        if (e.jobId === sub.jobId) sub.send(e);
        continue;
      }
      if (sub.accountId) {
        if (e.accountId === sub.accountId) sub.send(e);
        continue;
      }
      sub.send(e);
    }
  }
}

export const bus = new Bus();
