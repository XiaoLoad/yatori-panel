import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AnswerSourceEnum, SubmitModeEnum } from "../shared.ts";
import { getAccount } from "../db/accounts.ts";
import { gateway } from "../gateway.ts";
import { HttpError } from "../errors.ts";
import { ensureSession } from "../sessions.ts";
import { isExamRunning, listRunningExams, runSingleExam } from "../single-exam.ts";
import { isWorkRunning, listRunningWorks, runSingleWork } from "../single-work.ts";
import { assertAnswerSourceReady } from "./guards.ts";
import { parse } from "./shared.ts";

/** 查课程名用于日志标识（查不到不影响触发） */
async function courseNameOf(uid: string, courseId: string): Promise<string | undefined> {
  try {
    const sid = await ensureSession({ ...getAccount(uid)! });
    return (await gateway.courses(sid)).find((c) => c.id === courseId)?.name;
  } catch {
    return undefined;
  }
}

/** 课程与单场作业/考试：列表透传、只读查分、快捷触发、运行状态 */
export function registerCourseRoutes(app: FastifyInstance): void {
  app.get("/api/v1/accounts/:uid/courses", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.courses(sid) };
  });

  app.get("/api/v1/accounts/:uid/courses/:courseId/tree", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.tree(sid, courseId) };
  });

  // 考试列表透传（单场考试快捷触发的前置数据）
  app.get("/api/v1/accounts/:uid/courses/:courseId/exams", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.exams(sid, courseId) };
  });

  // 考试状态与成绩只读查询：仅英华，不进入考试、不消耗答题次数
  app.post("/api/v1/accounts/:uid/courses/:courseId/exams/results", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (account.platform !== "YINGHUA") {
      throw new HttpError(400, "考试状态与成绩查询暂仅支持英华学堂");
    }
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        exams: z
          .array(
            z.object({
              examId: z.string({ required_error: "缺少考试 ID" }).min(1, "缺少考试 ID"),
              nodeId: z.string({ required_error: "缺少节点 ID" }).min(1, "缺少节点 ID"),
            }),
          )
          .min(1, "缺少考试列表")
          .max(30, "单次最多查询 30 场考试"),
      }),
    );
    const sid = await ensureSession(account);
    return {
      ok: true,
      data: await gateway.examResults(sid, { courseId, exams: body.exams }),
    };
  });

  // 单场考试触发：与任务发起同一套答题来源预检门禁，不可用直接拒绝。
  // 后台执行 + SSE 实时状态（同步 HTTP 会让答题期间前端无任何反馈）。
  app.post("/api/v1/accounts/:uid/courses/:courseId/exams/do", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        examId: z.string({ required_error: "缺少考试 ID" }).min(1, "缺少考试 ID"),
        examName: z.string().optional().default(""),
        source: AnswerSourceEnum,
        submitMode: SubmitModeEnum.optional().default("direct"),
      }),
    );
    if (isExamRunning(account.uid, courseId, body.examId)) {
      throw new HttpError(409, "该考试正在答题中，请等待完成");
    }
    await assertAnswerSourceReady(body.source);
    await ensureSession(account);
    const examName = body.examName || body.examId;
    const courseName = await courseNameOf(account.uid, courseId);
    void runSingleExam({
      accountUid: account.uid,
      courseId,
      examId: body.examId,
      examName,
      courseName,
      source: body.source,
      submitMode: body.submitMode,
    });
    return { ok: true, data: { started: true, examName } };
  });

  // 单场考试运行状态（前端刷新页面后恢复"答题中"显示）
  app.get("/api/v1/accounts/:uid/exams/running", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    return {
      ok: true,
      data: listRunningExams().filter((r) => r.accountUid === account.uid),
    };
  });

  // 作业列表透传（单场作业快捷触发的前置数据）
  app.get("/api/v1/accounts/:uid/courses/:courseId/works", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const sid = await ensureSession(account);
    return { ok: true, data: await gateway.works(sid, courseId) };
  });

  // 作业状态与成绩只读查询：仅英华，不进入作答流程、不消耗做题次数
  app.post("/api/v1/accounts/:uid/courses/:courseId/works/results", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    if (account.platform !== "YINGHUA") {
      throw new HttpError(400, "作业状态与成绩查询暂仅支持英华学堂");
    }
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        works: z
          .array(
            z.object({
              workId: z.string({ required_error: "缺少作业 ID" }).min(1, "缺少作业 ID"),
              nodeId: z.string({ required_error: "缺少节点 ID" }).min(1, "缺少节点 ID"),
            }),
          )
          .min(1, "缺少作业列表")
          .max(30, "单次最多查询 30 份作业"),
      }),
    );
    const sid = await ensureSession(account);
    return {
      ok: true,
      data: await gateway.workResults(sid, { courseId, works: body.works }),
    };
  });

  // 单场作业触发（支持批量）：与单场考试同一套答题来源预检门禁，后台执行 + SSE 实时状态
  app.post("/api/v1/accounts/:uid/courses/:courseId/works/do", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    const { courseId } = req.params as { courseId: string };
    const body = parse(
      req.body,
      z.object({
        works: z
          .array(
            z.object({
              workId: z.string({ required_error: "缺少作业 ID" }).min(1, "缺少作业 ID"),
              workName: z.string().optional().default(""),
            }),
          )
          .min(1, "至少选择一份作业")
          .max(50, "单次最多批量完成 50 份作业"),
        source: AnswerSourceEnum,
        /** 提交模式：true 答完提交（默认），false 仅保存草稿 */
        submit: z.boolean().optional().default(true),
      }),
    );
    for (const w of body.works) {
      if (isWorkRunning(account.uid, courseId, w.workId)) {
        throw new HttpError(409, `作业「${w.workName || w.workId}」正在答题中，请等待完成`);
      }
    }
    await assertAnswerSourceReady(body.source);
    await ensureSession(account);
    const courseName = await courseNameOf(account.uid, courseId);
    void runSingleWork({
      accountUid: account.uid,
      courseId,
      works: body.works.map((w) => ({ workId: w.workId, workName: w.workName })),
      courseName,
      source: body.source,
      submit: body.submit,
    });
    return {
      ok: true,
      data: { started: true, count: body.works.length, names: body.works.map((w) => w.workName || w.workId) },
    };
  });

  // 单场作业运行状态（前端刷新页面后恢复"答题中"显示）
  app.get("/api/v1/accounts/:uid/works/running", async (req) => {
    const account = getAccount((req.params as { uid: string }).uid);
    if (!account) throw new HttpError(404, "账号不存在");
    return {
      ok: true,
      data: listRunningWorks().filter((r) => r.accountUid === account.uid),
    };
  });
}
