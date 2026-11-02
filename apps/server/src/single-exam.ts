import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { getSettings } from "./db/settings.ts";
import { gateway } from "./gateway.ts";
import type { GatewayExamProgress } from "./gateway.ts";
import { ensureSession } from "./sessions.ts";
import type { SubmitMode } from "./shared.ts";

/**
 * 单场考试后台运行器：触发即返回，过程经 SSE 推送实时状态。
 *
 * 英华 + 外置题库走网关逐题模式（每题一条进度事件：题面/命中/答案/保存结果），
 * 其余组合回退 SDK DoExam 黑盒（仅里程碑）。逐题模式同时让智能交卷的
 * 留空检测真正生效（SDK 不回填逐题答案）。
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
  courseName?: string;
  source: "off" | "ai" | "bank";
  submitMode: SubmitMode;
}): Promise<void> {
  const { accountUid, courseId, examId, examName, courseName, source, submitMode } = params;
  const key = `${accountUid}:${courseId}:${examId}`;
  if (running.has(key)) {
    throw new Error("该考试正在答题中，请等待完成");
  }
  const account = getAccount(accountUid);
  if (!account) throw new Error("账号不存在");

  // 日志前缀：账号（优先备注）+ 课程 + 考试名，多账号并发时一目了然
  const label = [
    courseName || `课程${courseId}`,
    examName || `考试${examId}`,
    `（${account.remark || account.username}）`,
  ].join(" · ");

  running.set(key, { accountUid, courseId, examId, examName });
  const modeText = { off: "不交卷", smart: "智能交卷", direct: "直接交卷" }[submitMode];
  emit(accountUid, "info", `[单场考试] ${label}：开始（答题来源 ${source === "ai" ? "AI" : "题库"} · ${modeText}）`);

  try {
    const sid = await ensureSession(account);
    const settings = getSettings();

    // 英华 + 外置题库 → 逐题模式（实时进度 + 留空检测）；其余回退 SDK 黑盒
    const useDetail = account.platform === "YINGHUA" && source === "bank";
    let detailResult: Awaited<ReturnType<typeof gateway.examDetail>> | null = null;

    if (useDetail) {
      // 逐题模式需要 nodeId（exams 列表 extra 携带）
      const exams = await gateway.exams(sid, courseId);
      const exam = exams.find((e) => e.id === examId);
      const nodeId = exam?.extra?.["nodeId"] ?? "";
      if (!nodeId) throw new Error("缺少考试 nodeId，请先刷新考试列表");
      emit(accountUid, "info", `[单场考试] ${label}：逐题模式开始（每题实时推送进度）…`);

      const onProgress = (p: GatewayExamProgress) => {
        const flag = p.blank ? "⚠ 留空" : p.hit ? "✓ 命中" : "✗ 未命中";
        const ans = p.answer.length ? ` → ${p.answer.join(" ")}` : "";
        const level: "info" | "warn" = p.blank || p.err ? "warn" : "info";
        emit(
          accountUid,
          level,
          `[单场考试] ${label}：第 ${p.index}/${p.total} 题（${p.type}）${flag}${ans}` +
            (p.err ? ` · ${p.err}` : p.savedMsg ? ` · ${p.savedMsg}` : ""),
        );
      };

      const submit = submitMode; // off / smart / direct 语义由网关逐题模块实现
      detailResult = await gateway.examDetail(
        sid,
        {
          courseId,
          examId,
          nodeId,
          bankUrl: settings.questionBank.enabled ? settings.questionBank.url : "",
          submitMode: submit,
        },
        onProgress,
      );

      const blankNote = detailResult.blank > 0 ? `，${detailResult.blank} 题留空` : "";
      if (detailResult.submitted) {
        emit(accountUid, "info", `[单场考试] ${label}：完成，已交卷（${detailResult.total} 题${blankNote}）`);
      } else if (submitMode === "smart" && detailResult.blank > 0) {
        emit(accountUid, "warn", `[单场考试] ${label}：已答题，有留空——智能交卷跳过提交（${detailResult.total} 题${blankNote}）`);
      } else {
        emit(accountUid, "info", `[单场考试] ${label}：已答题，未提交（${detailResult.total} 题${blankNote}）`);
      }
      return;
    }

    emit(accountUid, "info", `[单场考试] ${label}：会话就绪，进入考试并逐题作答…`);

    const run = (submit: boolean) =>
      gateway.doExam(sid, { courseId, examId, source, submit });

    let r;
    if (submitMode === "smart") {
      emit(accountUid, "info", `[单场考试] ${label}：第一阶段——全量作答并保存…`);
      const saved = await run(false);
      const answers = saved.answers ?? [];
      emit(
        accountUid,
        "info",
        `[单场考试] ${label}：已作答 ${answers.length} 题，检测留空…`,
      );
      const blank = answers.filter((a) => !a.value || a.value.length === 0).length;
      if (blank > 0) {
        emit(accountUid, "warn", `[单场考试] ${label}：${blank} 题未答上（留空），仅保存不交卷`);
        return;
      }
      emit(accountUid, "info", `[单场考试] ${label}：无留空，第二阶段——交卷…`);
      r = await run(true);
    } else {
      r = await run(submitMode === "direct");
    }

    if (r.submitted && r.score > 0) {
      emit(accountUid, "info", `[单场考试] ${label}：完成，得分 ${r.score}`);
    } else if (r.submitted) {
      emit(accountUid, "warn", `[单场考试] ${label}：已提交但未确认得分，请到平台核实`);
    } else {
      emit(accountUid, "info", `[单场考试] ${label}：已答题，未提交`);
    }
  } catch (err) {
    emit(accountUid, "error", `[单场考试] ${label}：失败——${(err as Error).message}`);
  } finally {
    running.delete(key);
  }
}
