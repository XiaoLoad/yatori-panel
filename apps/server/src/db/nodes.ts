import { now, sqlite } from "./index.ts";

export interface NodeCacheRow {
  nodeId: string;
  name: string;
  kind: string;
  progress: number;
  completed: boolean;
  flagged: boolean;
}

const upsert = sqlite.prepare(`
INSERT INTO node_cache (account_uid, course_id, node_id, name, kind, progress, completed, flagged, updated_at)
VALUES (@accountUid, @courseId, @nodeId, @name, @kind, @progress, @completed, @flagged, @updatedAt)
ON CONFLICT(account_uid, course_id, node_id) DO UPDATE SET
  name = excluded.name,
  kind = excluded.kind,
  progress = excluded.progress,
  completed = excluded.completed,
  flagged = MAX(node_cache.flagged, excluded.flagged),
  updated_at = excluded.updated_at
`);

export function upsertNode(
  accountUid: string,
  courseId: string,
  node: { id: string; name: string; kind: string },
  progress: number,
  completed: boolean,
  flagged: boolean,
): void {
  upsert.run({
    accountUid,
    courseId,
    nodeId: node.id,
    name: node.name,
    kind: node.kind,
    progress,
    completed: completed ? 1 : 0,
    flagged: flagged ? 1 : 0,
    updatedAt: now(),
  });
}

export function flaggedNodeIds(accountUid: string, courseId: string): string[] {
  const rows = sqlite
    .prepare(`SELECT node_id FROM node_cache WHERE account_uid = ? AND course_id = ? AND flagged = 1`)
    .all(accountUid, courseId) as { node_id: string }[];
  return rows.map((r) => r.node_id);
}

export function clearCourseCache(accountUid: string, courseId: string): void {
  sqlite
    .prepare(`DELETE FROM node_cache WHERE account_uid = ? AND course_id = ?`)
    .run(accountUid, courseId);
}
