import { existsSync } from "node:fs";
import process from "node:process";

export interface NodeRuntimeConfig {
  readonly workspaceDirectory: string;
  readonly maxDurationSeconds: number;
  readonly ai?: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly asrModel: string;
    readonly textModel: string;
  };
}
export function loadLocalEnvironment(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readNodeRuntimeConfig(): NodeRuntimeConfig {
  const apiKey = process.env.HONGTAI_AI_API_KEY?.trim();
  const maxDuration = Number(process.env.HONGTAI_MAX_DURATION_SECONDS ?? "1200");
  return {
    workspaceDirectory: process.env.HONGTAI_WORKSPACE_DIR?.trim() || "./workspace",
    maxDurationSeconds: Number.isFinite(maxDuration) && maxDuration > 0 ? maxDuration : 1_200,
    ai: apiKey
      ? {
          baseUrl: process.env.HONGTAI_AI_BASE_URL?.trim() || "https://api.xiaomimimo.com/v1",
          apiKey,
          asrModel: process.env.HONGTAI_ASR_MODEL?.trim() || "mimo-v2.5-asr",
          textModel: process.env.HONGTAI_TEXT_MODEL?.trim() || "mimo-v2.5",
        }
      : undefined,
  };
}
