import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";
import { HttpError } from "../errors.ts";

export type { FastifyReply, FastifyRequest };

/** zod schema 校验：失败统一抛 400 */
export function parse<T>(body: unknown, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "));
  }
  return r.data;
}

/** 从路径参数读取 uid 并加载账号，不存在直接 404 */
export function accountParam(req: FastifyRequest): string {
  const { uid } = req.params as { uid: string };
  if (!uid) throw new HttpError(400, "缺少账号 ID");
  return uid;
}

/** 分页参数归一：page 从 1 起，pageSize 限制在 [min,max] */
export function pageParams(
  q: { page?: string; pageSize?: string },
  defaultSize: number,
  maxSize: number,
): { page: number; pageSize: number } {
  return {
    page: Math.max(1, Number(q.page) || 1),
    pageSize: Math.min(maxSize, Math.max(10, Number(q.pageSize) || defaultSize)),
  };
}

/** 布尔查询参数归一 */
export function boolQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true" || value === "1";
}

export { z };
