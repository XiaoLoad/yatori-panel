import type { JobCourseProgress, JobEvent, JobVO } from "@yatori/shared";

/**
 * 仅用于前端视觉验收的模拟数据：
 * 不写入数据库、不经过接口，开启“演示数据”时替换观测台的运行中任务。
 */
export const DEMO_ACCOUNT_LABELS: Record<string, string> = {
  "demo-a": "演示账号 A · 三课程并行",
  "demo-b": "演示账号 B · 单课程",
  "demo-c": "演示账号 C · 五课程并行",
  "demo-d": "演示账号 D · 已完成一门",
  "demo-e": "演示账号 E · 六门含等待加载",
  "demo-f": "演示账号 F · 四课程并行",
  "demo-g": "演示账号 G · 两课程并行",
  "demo-h": "演示账号 H · 三课程并行",
};

interface DemoCourseSpec {
  id: string;
  name: string;
  hours: number;
  progress: number;
  node?: string;
  completed?: boolean;
  loaded?: boolean;
}

function buildCourse(spec: DemoCourseSpec): JobCourseProgress {
  const totalSeconds = Math.round(spec.hours * 3600);
  const remainingSeconds = spec.completed ? 0 : Math.round(totalSeconds * (1 - spec.progress / 100));
  return {
    courseId: spec.id,
    courseName: spec.name,
    totalSeconds,
    remainingSeconds,
    progress: spec.completed ? 100 : spec.progress,
    completed: !!spec.completed,
    loaded: spec.loaded ?? true,
    currentNodeName: spec.completed ? undefined : spec.node,
  };
}

function buildDemoTask(
  key: string,
  startMinutesAgo: number,
  courses: DemoCourseSpec[],
  concurrency = 3,
): { job: JobVO; progress: JobEvent } {
  const coursesProgress = courses.map(buildCourse);
  const courseTotalSeconds = coursesProgress.reduce((s, c) => s + c.totalSeconds, 0);
  const courseRemainingSeconds = coursesProgress.reduce((s, c) => s + c.remainingSeconds, 0);
  const coursesRemaining = coursesProgress.filter((c) => !c.completed).length;
  const activeLeft = Math.max(1, coursesProgress.filter((c) => !c.completed && c.remainingSeconds > 0).length);
  const activeCourses = Math.max(1, Math.min(concurrency, activeLeft));
  const current = coursesProgress.find((c) => !c.completed) ?? coursesProgress[0]!;
  const startedAt = new Date(Date.now() - startMinutesAgo * 60_000).toISOString();
  const options = {
    accountUid: key,
    courseIds: coursesProgress.map((c) => c.courseId),
    videoMode: 1 as const,
    answerSource: "off" as const,
    submitMode: "off" as const,
    perCourseConcurrency: 4,
  };

  return {
    job: {
      id: `demo-job-${key}`,
      accountUid: key,
      accountName: DEMO_ACCOUNT_LABELS[key],
      options,
      state: "running",
      startedAt,
      finishedAt: null,
      summary: null,
      progress: null,
    },
    progress: {
      type: "task.progress",
      ts: Date.now(),
      jobId: `demo-job-${key}`,
      accountId: key,
      phase: "video",
      courseId: current.courseId,
      courseName: current.courseName,
      nodeId: "demo-node",
      nodeName: current.currentNodeName,
      progress: 46,
      watchedSeconds: 540,
      totalSeconds: 1200,
      courseTotalSeconds,
      courseRemainingSeconds,
      courseCount: coursesProgress.length,
      coursesRemaining,
      etaSeconds: Math.round(courseRemainingSeconds / activeCourses),
      coursesProgress,
    },
  };
}

/**
 * 覆盖几种典型边界：单课程、多课程并行、已完成课程、未加载章节、课程较多的长列表。
 */
export const DEMO_RUNNING_TASKS = [
  buildDemoTask(
    "demo-a",
    12,
    [
      { id: "d-a-1", name: "大学生国家安全教育", hours: 11.92, progress: 54, node: "9.3 科技安全基本机理" },
      { id: "d-a-2", name: "实验室安全教育 第二版", hours: 4.42, progress: 62, node: "第 3 章 化学品安全" },
      { id: "d-a-3", name: "艺术导论", hours: 5.65, progress: 21, node: "2.1 艺术的起源" },
    ],
  ),
  buildDemoTask(
    "demo-b",
    26,
    [{ id: "d-b-1", name: "大学英语（二）", hours: 6.4, progress: 78, node: "Unit 5 Reading" }],
    1,
  ),
  buildDemoTask(
    "demo-c",
    41,
    [
      { id: "d-c-1", name: "计算机网络基础", hours: 9.6, progress: 38, node: "3.2 TCP 协议" },
      { id: "d-c-2", name: "数据结构与算法", hours: 12.4, progress: 25, node: "4.1 树与二叉树" },
      { id: "d-c-3", name: "操作系统原理", hours: 8.8, progress: 44, node: "2.4 进程调度" },
      { id: "d-c-4", name: "数据库系统概论", hours: 7.2, progress: 12, node: "1.3 关系模型" },
      { id: "d-c-5", name: "软件工程", hours: 6.5, progress: 5, node: "1.1 软件生命周期" },
    ],
  ),
  buildDemoTask(
    "demo-d",
    65,
    [
      { id: "d-d-1", name: "中国近现代史纲要", hours: 8.2, progress: 100, completed: true },
      { id: "d-d-2", name: "马克思主义基本原理", hours: 7.4, progress: 41, node: "3.2 唯物辩证法" },
    ],
  ),
  buildDemoTask(
    "demo-e",
    125,
    [
      { id: "d-e-1", name: "高等数学（上）", hours: 14.2, progress: 18, node: "2.1 极限的定义" },
      { id: "d-e-2", name: "线性代数", hours: 9.4, progress: 7, node: "1.2 矩阵运算" },
      { id: "d-e-3", name: "概率论与数理统计", hours: 10.1, progress: 0, node: "1.1 随机事件", loaded: false },
      { id: "d-e-4", name: "大学物理", hours: 11.8, progress: 0, loaded: false },
      { id: "d-e-5", name: "程序设计基础", hours: 8.6, progress: 0, loaded: false },
      { id: "d-e-6", name: "思想道德与法治", hours: 7.9, progress: 0, loaded: false },
    ],
    2,
  ),
  buildDemoTask(
    "demo-f",
    180,
    [
      { id: "d-f-1", name: "大学语文", hours: 5.2, progress: 61, node: "3.2 古文阅读" },
      { id: "d-f-2", name: "经济学基础", hours: 6.8, progress: 34, node: "2.4 供求关系" },
      { id: "d-f-3", name: "管理学原理", hours: 7.5, progress: 18, node: "1.3 管理职能" },
      { id: "d-f-4", name: "市场营销学", hours: 6.1, progress: 8, node: "1.1 市场概述" },
    ],
  ),
  buildDemoTask(
    "demo-g",
    240,
    [
      { id: "d-g-1", name: "大学体育（二）", hours: 4.8, progress: 72, node: "第 4 周 体能训练" },
      { id: "d-g-2", name: "军事理论", hours: 5.6, progress: 46, node: "2.3 国防建设" },
    ],
    2,
  ),
  buildDemoTask(
    "demo-h",
    300,
    [
      { id: "d-h-1", name: "Python 程序设计", hours: 9.2, progress: 55, node: "4.1 函数与模块" },
      { id: "d-h-2", name: "人工智能导论", hours: 8.4, progress: 29, node: "2.2 机器学习基础" },
      { id: "d-h-3", name: "Web 前端开发", hours: 7.8, progress: 13, node: "1.4 CSS 布局" },
    ],
  ),
];
