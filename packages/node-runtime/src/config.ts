import { existsSync } from "node:fs";
import process from "node:process";
import type { NodeOpenAiCompatibleProviderConfig } from "@hongtai/ai/node";
import { TaskError } from "@hongtai/core";

export interface NodeRuntimeConfig {
  readonly workspaceDirectory: string;
  readonly maxDurationSeconds: number;
  readonly ai?: NodeOpenAiCompatibleProviderConfig;
}

export type AiModelCapability = keyof NodeOpenAiCompatibleProviderConfig["models"];

export function requireAiModels(
  config: NodeOpenAiCompatibleProviderConfig | undefined,
  capabilities: readonly AiModelCapability[],
): NodeOpenAiCompatibleProviderConfig {
  if (!config) {
    throw new TaskError({ code: "AI_NOT_CONFIGURED", message: "未配置AI连接，请填写Base URL和API Key", action: "configure_ai" });
  }
  const labels: Record<AiModelCapability, string> = { text: "文本", vision: "视觉", asr: "ASR" };
  const missing = capabilities.filter((capability) => !config.models[capability]?.trim());
  if (missing.length > 0) {
    throw new TaskError({ code: "AI_NOT_CONFIGURED", message: `当前命令缺少${missing.map((item) => labels[item]).join("、")}模型配置`, action: "configure_ai" });
  }
  return config;
}

export function loadLocalEnvironment(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readNodeRuntimeConfig(): NodeRuntimeConfig {
  const baseUrl = process.env.HONGTAI_AI_BASE_URL?.trim();
  const apiKey = process.env.HONGTAI_AI_API_KEY?.trim();
  const textModel = process.env.HONGTAI_TEXT_MODEL?.trim();
  const visionModel = process.env.HONGTAI_VISION_MODEL?.trim();
  const asrModel = process.env.HONGTAI_ASR_MODEL?.trim();
  const hasAiSetting = Boolean(baseUrl || apiKey || textModel || visionModel || asrModel);
  if (hasAiSetting && (!baseUrl || !apiKey)) {
    throw new TaskError({
      code: "AI_NOT_CONFIGURED",
      message: "AI连接配置不完整，请同时填写Base URL和API Key",
      action: "configure_ai",
    });
  }
  const maxDuration = Number(process.env.HONGTAI_MAX_DURATION_SECONDS ?? "1200");
  const contextWindow = Number(process.env.HONGTAI_AI_CONTEXT_WINDOW_TOKENS ?? "32000");
  return {
    workspaceDirectory: process.env.HONGTAI_WORKSPACE_DIR?.trim() || "./workspace",
    maxDurationSeconds: Number.isFinite(maxDuration) && maxDuration > 0 ? maxDuration : 1_200,
    ai: hasAiSetting && baseUrl && apiKey
      ? {
          baseUrl,
          apiKey,
          models: {
            ...(textModel ? { text: textModel } : {}),
            ...(visionModel ? { vision: visionModel } : {}),
            ...(asrModel ? { asr: asrModel } : {}),
          },
          supportsJsonObject: process.env.HONGTAI_AI_JSON_OBJECT?.trim().toLowerCase() !== "false",
          supportsJsonSchema: process.env.HONGTAI_AI_JSON_SCHEMA?.trim().toLowerCase() === "true",
          asrTransport: process.env.HONGTAI_AI_ASR_TRANSPORT?.trim() === "chat-input-audio" ? "chat-input-audio" : "audio-transcriptions",
          contextWindowTokens: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32_000,
          reasoningMode: "provider-default",
        }
      : undefined,
  };
}
