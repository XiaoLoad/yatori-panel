import { gateway } from "../gateway.ts";
import { getSettings } from "../db/settings.ts";
import { HttpError } from "../errors.ts";

/** AI/题库配置的零成本前置校验：缺配置直接拒绝，不发起注定失败的探针请求 */
function ensureAnswerConfigReady(
  source: "off" | "ai" | "bank",
  settings: ReturnType<typeof getSettings>,
): void {
  if (source === "ai" && (!settings.ai.enabled || !settings.ai.url || !settings.ai.apiKey)) {
    throw new HttpError(400, "请先在全局设置中完成 AI 答题配置（接口地址与 API Key 必填）");
  }
  if (source === "bank" && (!settings.questionBank.enabled || !settings.questionBank.url)) {
    throw new HttpError(400, "请先在全局设置中启用外置题库并填写服务地址");
  }
}

/**
 * 答题来源可用性校验：批量任务/单任务/单场作业/单场考试共用同一套门禁，
 * 统一在这里做配置检查 + 网关预检，避免四条路由各自维护重复逻辑。
 */
export async function assertAnswerSourceReady(source: "off" | "ai" | "bank"): Promise<void> {
  if (source === "off") return;
  const settings = getSettings();
  ensureAnswerConfigReady(source, settings);
  const pre =
    source === "ai"
      ? await gateway.preflight({
          source: "ai",
          ai: {
            type: settings.ai.type,
            url: settings.ai.url,
            model: settings.ai.model,
            apiKey: settings.ai.apiKey,
          },
        })
      : await gateway.preflight({
          source: "bank",
          questionBank: {
            url: settings.questionBank.url,
            key: settings.questionBank.key,
          },
        });
  if (!pre.available) {
    const label = source === "ai" ? "AI" : "外置题库";
    throw new HttpError(400, `${label}预检未通过：${pre.error ?? "不可用"}`);
  }
}
