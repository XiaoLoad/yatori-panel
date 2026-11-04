import { bus } from "./bus.ts";
import { getAccount } from "./db/accounts.ts";
import { gateway } from "./gateway.ts";
import { ensureSession } from "./sessions.ts";

/**
 * 单场作业后台运行器：触发即返回，结果经 SSE 推送。
 * 与单场考试（single-exam.ts）同构：内存态、防并发重入、账号级语义沿用 jobManager。
 * 支持批量：一次传入多份作业串行执行，单份失败不影响后续。
 * 得分回查依赖 SDK DoWork 的返回（英华 submit=1 时自动查最终得分），
 * 学习通无独立查分接口，提示用户到平台核实。
 */

interface SingleWorkRun {
  accountUid: string;
  courseId: string;
  workId: string;
  workName: string;
}

const running = new Map<string, SingleWorkRun>(); // key: accountUid:courseId:workId

export function isWorkRunning(accountUid: string, courseId: string, workId: string): boolean {
  return running.has(`${accountUid}:${courseId}:${workId}`);
}

export function listRunningWorks(): { accountUid: string; courseId: string; workId: string }[] {
  return [...running.values()].map((r) => ({
    accountUid: r.accountUid,
    courseId: r.courseId,
    workId: r.workId,
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

async function runOneWork(
  account: NonNullable<ReturnType<typeof getAccount>>,
  sid: string,
  ctx: {
    accountUid: string;
    courseId: string;
    workId: string;
    workName: string;
    courseName?: string;
    source: "off" | "ai" | "bank";
    submit: boolean;
  },
): Promise<void> {
  const { accountUid, courseId, workId, workName, courseName, source, submit } = ctx;
  const label = [
    courseName || `课程${courseId}`,
    workName || `作业${workId}`,
    `（${account.remark || account.username}）`,
  ].join(" · ");
  const key = `${accountUid}:${courseId}:${workId}`;

  running.set(key, { accountUid, courseId, workId, workName });
  const sourceText = { off: "仅拉取不答题", ai: "AI 答题", bank: "题库答题" }[source];
  const submitText = submit ? "答完提交" : "仅保存不提交";
  emit(accountUid, "info", `[单场作业] ${label}：开始（${sourceText} · ${submitText}）`);

  try {
    emit(accountUid, "info", `[单场作业] ${label}：会话就绪，进入作业并作答…`);
    const r = await gateway.doWork(sid, { courseId, workId, source, submit });

    if (r.submitted && r.score > 0) {
      emit(accountUid, "info", `[单场作业] ${label}：完成，已提交，得分 ${r.score}`);
    } else if (r.submitted) {
      emit(accountUid, "info", `[单场作业] ${label}：完成，已提交（平台未回传得分，请到平台核实）`);
    } else if (source === "off") {
      emit(accountUid, "info", `[单场作业] ${label}：已拉取题目（仅查看模式，未作答）`);
    } else {
      emit(accountUid, "info", `[单场作业] ${label}：已作答并保存，未提交（草稿模式）`);
    }
  } catch (err) {
    emit(accountUid, "error", `[单场作业] ${label}：失败——${(err as Error).message}`);
  } finally {
    running.delete(key);
  }
}

export async function runSingleWork(params: {
  accountUid: string;
  courseId: string;
  /** 批量作业列表，串行执行；单份失败不中断 */
  works: { workId: string; workName: string }[];
  courseName?: string;
  source: "off" | "ai" | "bank";
  submit: boolean;
}): Promise<void> {
  const { accountUid, courseId, works, courseName, source, submit } = params;
  const account = getAccount(accountUid);
  if (!account) throw new Error("账号不存在");

  // 批量任务本身防重入（同一批不允许并发发起）
  const batchKey = works
    .map((w) => `${accountUid}:${courseId}:${w.workId}`)
    .sort()
    .join("|");
  if (running.has(batchKey)) throw new Error("该批作业正在处理中，请等待完成");

  const scope = courseName || `课程${courseId}`;
  const total = works.length;
  emit(
    accountUid,
    "info",
    `[单场作业] ${scope}（${account.remark || account.username}）：批量任务开始，共 ${total} 份作业`,
  );
  running.set(batchKey, { accountUid, courseId, workId: "", workName: "" });

  try {
    // 会话全程复用：登录超时由网关侧原地重登自愈
    const sid = await ensureSession(account);
    let done = 0;
    for (const w of works) {
      done += 1;
      emit(accountUid, "info", `[单场作业] 批量进度 ${done}/${total}`);
      await runOneWork(account, sid, {
        accountUid,
        courseId,
        workId: w.workId,
        workName: w.workName,
        courseName,
        source,
        submit,
      });
    }
    emit(accountUid, "info", `[单场作业] ${scope}：批量任务结束（${total} 份）`);
  } catch (err) {
    emit(accountUid, "error", `[单场作业] ${scope}：批量任务异常终止——${(err as Error).message}`);
  } finally {
    running.delete(batchKey);
  }
}
