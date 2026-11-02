import { defineStore } from "pinia";
import { ref } from "vue";
import type { JobEvent, JobSummary } from "@yatori/shared";
import { playJobSound } from "@/lib/audio";

const LOG_BUFFER = 800;

export interface JobLiveState {
  state?: string;
  lastState?: string;
  message?: string;
  summary?: JobSummary;
  /** 任务内最近一次进度事件，用于控制台实时展示当前节点 */
  lastProgress?: JobEvent;
}

export const useEventStore = defineStore("events", () => {
  const logs = ref<JobEvent[]>([]);
  const flags = ref<JobEvent[]>([]);
  const jobLive = ref<Record<string, JobLiveState>>({});
  const connected = ref(false);

  function ingest(e: JobEvent) {
    switch (e.type) {
      case "log":
        logs.value.push(e);
        if (logs.value.length > LOG_BUFFER) {
          logs.value.splice(0, logs.value.length - LOG_BUFFER);
        }
        break;
      case "task.progress": {
        const s = ensureJob(e.jobId);
        s.lastProgress = e;
        break;
      }
      case "task.flag":
        flags.value.unshift(e);
        if (flags.value.length > 100) flags.value.pop();
        break;
      case "job.status": {
        const s = ensureJob(e.jobId);
        s.state = e.state;
        s.message = e.message;
        if (e.summary) s.summary = e.summary;
        // 终态提示音（运行中→完成/出错），手动停止不响
        if ((e.state === "done" || e.state === "error") && s.lastState === "running") {
          playJobSound(e.state === "error" ? "error" : "done");
        }
        s.lastState = e.state;
        break;
      }
    }
  }

  function ensureJob(jobId?: string): JobLiveState {
    const key = jobId ?? "_";
    return (jobLive.value[key] ??= {});
  }

  function resetJob(jobId: string) {
    delete jobLive.value[jobId];
  }

  return { logs, flags, jobLive, connected, ingest, resetJob };
});
