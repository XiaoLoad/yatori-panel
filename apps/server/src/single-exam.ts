import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { getSettings } from "./db/settings.ts";
import { gateway } from "./gateway.ts";
import { ensureSession } from "./sessions.ts";
import type { SubmitMode } from "./shared.ts";

/**
 * 单场考试后台运行器：触发即返回，过程经 SSE 推送实时状态。
 *
 * 为什么后台化：SDK DoExam 是同步 for 循环（逐题拉取/答题/保存），
 * 同步 HTTP 会让前端整个答题期间无任何反馈。这里把里程碑
 * （进入考试 → 已保存 → 交卷 → 结果）经事件总线广播给前端，
 * 配合网关会话日志流形成可观测的答题过程。
 *
 * 状态仅存内存（单场考试是即时操作，无需持久化）；账号级互斥与
 * 完整任务共用 jobManager 的语义，这里独立防并发重入。
 */

interface SingleExamRun {
  accountUid: string;
  courseId: string;
  examId: string;
  examName: string;
}

const running = new Map<string, SingleExamRun>(); // key: accountUid:courseId:examId

export function isExamRunning(accountUid: string, courseId: string, examId: string): boolean {
  return running.has(`${accountUid}:${courseId}:${examId}`);
}

export function listRunningExams(): { accountUid: string; courseId: string; examId: string }[] {
  return [...running.values()].map((r) => ({
    accountUid: r.accountUid,
    courseId: r.courseId,
    examId: r.examId,
  }));
}

function emit(accountUid: string, level: "info" | "warn" | "error", message: string): void {
  bus.publish({
    type: "log",
    ts: Date.now(),
    accountId: accountUid,
    level,
    message,
  });
}

export async function runSingleExam(params: {
  accountUid: string;
  courseId: string;
  examId: string;
  examName: string;
  source: "off" | "ai" | "bank";
  submitMode: SubmitMode;
}): Promise<void> {
  const { accountUid, courseId, examId, examName, source, submitMode } = params;
  const key = `${accountUid}:${courseId}:${examId}`;
  if (running.has(key)) {
    throw new Error("该考试正在答题中，请等待完成");
  }
  const account = getAccount(accountUid);
  if (!account) throw new Error("账号不存在");

  running.set(key, { accountUid, courseId, examId, examName });
  const modeText = { off: "不交卷", smart: "智能交卷", direct: "直接交卷" }[submitMode];
  emit(accountUid, "info", `[单场考试] ${examName}：开始（答题来源 ${source === "ai" ? "AI" : "题库"} · ${modeText}）`);

  try {
    const sid = await ensureSession(account);
    emit(accountUid, "info", `[单场考试] ${examName}：会话就绪，进入考试并逐题作答…`);

    const run = (submit: boolean) =>
      gateway.doExam(sid, { courseId, examId, source, submit });

    let r;
    if (submitMode === "smart") {
      emit(accountUid, "info", `[单场考试] ${examName}：第一阶段——全量作答并保存…`);
      const saved = await run(false);
      const answers = saved.answers ?? [];
      emit(
        accountUid,
        "info",
        `[单场考试] ${examName}：已作答 ${answers.length} 题，检测留空…`,
      );
      const blank = answers.filter((a) => !a.value || a.value.length === 0).length;
      if (blank > 0) {
        emit(accountUid, "warn", `[单场考试] ${examName}：${blank} 题未答上（留空），仅保存不交卷`);
        return;
      }
      emit(accountUid, "info", `[单场考试] ${examName}：无留空，第二阶段——交卷…`);
      r = await run(true);
    } else {
      r = await run(submitMode === "direct");
    }

    if (r.submitted && r.score > 0) {
      emit(accountUid, "info", `[单场考试] ${examName}：完成，得分 ${r.score}`);
    } else if (r.submitted) {
      emit(accountUid, "warn", `[单场考试] ${examName}：已提交但未确认得分，请到平台核实`);
    } else {
      emit(accountUid, "info", `[单场考试] ${examName}：已答题，未提交`);
    }
  } catch (err) {
    emit(accountUid, "error", `[单场考试] ${examName}：失败——${(err as Error).message}`);
  } finally {
    running.delete(key);
  }
}
