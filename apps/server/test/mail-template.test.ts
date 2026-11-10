import { describe, expect, test } from "bun:test";
import { completionEmailHtml } from "../src/mail-template.ts";

const LONG_NAME =
  "习近平新时代中国特色社会主义思想概论（2026年秋季学期网络课程）";

const html = completionEmailHtml({
  account: { username: "2025305835", remark: "示例账号" },
  state: "done",
  summary: {
    courses: 3,
    videosCompleted: 2,
    videosSkipped: 3,
    flagsFound: 0,
    worksDone: 1,
    examsDone: 1,
    scores: ["创业基础/结课考试 85分"],
    examScores: [{ courseName: "创业基础", examName: "结课考试", score: 85 }],
    errors: [],
    courseResults: [
      {
        name: LONG_NAME,
        progress: 100,
        completed: true,
        totalSeconds: 4212,
        state: "completed",
        videosCompleted: 2,
        videosSkipped: 0,
        videosLocked: 0,
        worksDone: 1,
        examsDone: 1,
      },
      {
        name: "马克思主义基本原理概论",
        progress: 42,
        completed: false,
        totalSeconds: 5883,
        state: "locked",
        videosCompleted: 0,
        videosSkipped: 3,
        videosLocked: 3,
        worksDone: 0,
        examsDone: 0,
      },
    ],
  },
  startedAt: "2026-11-10T14:00:00.000Z",
  finishedAt: "2026-11-10T15:23:00.000Z",
});

describe("completionEmailHtml", () => {
  test("模板不再出现英文副标题与英文数据标签", () => {
    expect(html).not.toMatch(/OUTPUT|COURSES|JOB\s*REPORT|DURATION|FINISHED\s*AT/);
    expect(html).toContain("产出明细");
    expect(html).toContain("课程明细");
    expect(html).toContain("任务报告");
  });

  test("长课程名截断显示并用 title 提供完整名称悬浮提示", () => {
    expect(html).toContain("…");
    expect(html).toContain(`title="${LONG_NAME}"`);
  });

  test("未解锁课程有独立状态与进度条颜色", () => {
    expect(html).toContain("未解锁");
    expect(html).toContain("3 个视频未到解锁时间");
    expect(html).toContain("#d19a3e");
  });

  test("已完成课程展示 100% 且不再误标未完成", () => {
    expect(html).toContain(">100%<");
    expect(html).not.toContain(`${LONG_NAME}</div>`);
  });

  test("考试类数据有独立统计与成绩明细", () => {
    expect(html).toContain("本次共完成考试");
    expect(html).toContain("考试成绩");
    expect(html).toContain("结课考试");
    expect(html).toContain("85");
  });
});
