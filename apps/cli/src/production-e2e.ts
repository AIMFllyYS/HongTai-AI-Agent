import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { MIMO_CHAT_AUDIO_TTS_INSTRUCTION, type AiProvider } from "@hongtai/ai";
import { createNodeOpenAiCompatibleProvider } from "@hongtai/ai/node";
import { StandaloneProductionService } from "@hongtai/capacitor-runtime";
import type { ScriptStoryboard, TaskDetailRecord } from "@hongtai/core";
import { loadLocalEnvironment } from "@hongtai/node-runtime";

/**
 * 制作管线真 API 复现 harness（开发回归，不进 APK）。
 *
 * 串行执行 v4 管线：create → importAssets → generateScript → synthesizeNarration →
 * composeMeasuredPlan。文本走 MiMo chat-completions（与 App 同一 Provider），逐句配音按
 * CloudNarrationSynthesizer 的 MiMo chat-audio 协议直连真实端点，实测时长从 RIFF 头解析。
 * 渲染阶段属 Android Media3，本 harness 不覆盖。
 *
 * 配置只从环境变量读取：MIMO_API_KEY（必填）、MIMO_BASE_URL（默认小米 MiMo 官方地址）。
 * Key 严禁写入任何产物或日志；产物只包含产品 DTO（脚本、实测时长、计划、软违规）。
 */

const MIMO_PRESET = {
  baseUrl: "https://api.xiaomimimo.com/v1",
  textModel: "mimo-v2.5",
  ttsModel: "mimo-v2.5-tts",
  ttsVoice: "冰糖",
  ttsTransport: "mimo-chat-audio" as const,
};

const HELP = `制作管线真 API 端到端复现

用法：
  pnpm cli production-e2e [--mode montage|avatar] [--brief <制作需求>] [--target-seconds <秒>]

环境变量：
  MIMO_API_KEY   必填，小米 MiMo API Key
  MIMO_BASE_URL  可选，默认 ${MIMO_PRESET.baseUrl}

说明：
  montage：智能成片链路（AI 分镜脚本 → 逐句 MiMo 配音 → 实测组装 v4 计划）。
  avatar：数字人链路（10 秒预处理视频 + 30 秒配音目标，验证裁剪/拼接前置链路）。
  产物写入 output/dev-e2e/，含逐句实测时长与最终计划 JSON；不含 API Key 与推理文本。
`;

interface E2eOptions {
  readonly mode: "montage" | "avatar";
  readonly brief: string;
  readonly targetSeconds: number;
  readonly outputDirectory: string;
}

function parseOptions(args: readonly string[]): E2eOptions {
  const options: { mode?: "montage" | "avatar"; brief?: string; targetSeconds?: number; outputDirectory?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") {
      const value = args[index + 1];
      if (value !== "montage" && value !== "avatar") throw new Error("--mode 只支持 montage 或 avatar");
      options.mode = value;
      index += 1;
      continue;
    }
    if (argument === "--brief") {
      const value = args[index + 1];
      if (!value) throw new Error("--brief 缺少文案参数");
      options.brief = value;
      index += 1;
      continue;
    }
    if (argument === "--target-seconds") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value < 15 || value > 60) throw new Error("--target-seconds 必须是 15 到 60 的秒数");
      options.targetSeconds = value;
      index += 1;
      continue;
    }
    if (argument === "--output") {
      const value = args[index + 1];
      if (!value) throw new Error("--output 缺少目录参数");
      options.outputDirectory = value;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return {
    mode: options.mode ?? "montage",
    brief: options.brief ?? "做一条让附近居民放心到店的推拿服务介绍视频，突出真实服务过程",
    targetSeconds: options.targetSeconds ?? 30,
    outputDirectory: options.outputDirectory ?? "output/dev-e2e",
  };
}

/** 与 CloudNarrationSynthesizer 一致的 MiMo chat-audio 协议；返回 base64 解码后的 WAV 字节。 */
async function synthesizeMiMoWav(
  baseUrl: string,
  apiKey: string,
  speechText: string,
): Promise<Uint8Array> {
  // 相对路径拼接会丢掉末段（/v1 → 根路径），必须先补尾斜杠再 join。
  const endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MIMO_PRESET.ttsModel,
      messages: [
        { role: "user", content: MIMO_CHAT_AUDIO_TTS_INSTRUCTION },
        { role: "assistant", content: speechText },
      ],
      audio: { format: "wav", voice: MIMO_PRESET.ttsVoice },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`MiMo TTS 请求被拒绝（HTTP ${response.status}${detail ? `：${detail}` : ""}）`);
  }
  const payload = await response.json() as {
    choices?: readonly { message?: { audio?: { data?: string } } }[];
  };
  const encoded = payload.choices?.[0]?.message?.audio?.data?.trim();
  if (!encoded) throw new Error("MiMo TTS 未返回音频数据");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) throw new Error("MiMo TTS 返回了空音频");
  return bytes;
}

/**
 * 从 RIFF 头解析 WAV 实测时长（毫秒）。等价于 Android 侧 MediaMetadataRetriever 的
 * METADATA_KEY_DURATION：data 块字节数除以 fmt 块的 byteRate。
 */
function wavDurationMs(bytes: Uint8Array): number {
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  const le32 = (offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("MiMo TTS 返回的不是 WAV 音频");
  }
  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = tag(offset);
    const chunkSize = le32(offset + 4);
    if (chunkId === "fmt " && offset + 8 + 16 <= bytes.length) {
      byteRate = le32(offset + 16);
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !dataSize) throw new Error("WAV 头缺少 fmt 或 data 块，无法计算实测时长");
  const durationMs = Math.round((dataSize / byteRate) * 1_000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("WAV 实测时长非法");
  return durationMs;
}

interface HarnessSummary {
  mode: "montage" | "avatar";
  startedAt: string;
  brief: string;
  targetSeconds: number;
  script?: { readonly purpose: string; readonly sentences: readonly { readonly id: string; readonly text: string; readonly estimatedMs: number }[] };
  narration?: readonly { readonly sentenceId: string; readonly durationMs: number }[];
  planPath?: string;
  softViolations?: readonly unknown[];
  failure?: { readonly code?: string; readonly action?: string; readonly message: string };
}

export async function runProductionE2e(args: readonly string[]): Promise<void> {
  const [first] = args;
  if (first === "--help" || first === "-h") {
    console.log(HELP);
    return;
  }
  const options = parseOptions(args);
  const projectRoot = resolve(import.meta.dirname, "../../..");
  loadLocalEnvironment(resolve(projectRoot, ".env"));

  const apiKey = process.env.MIMO_API_KEY?.trim();
  const baseUrl = (process.env.MIMO_BASE_URL?.trim() || MIMO_PRESET.baseUrl).replace(/\/+$/u, "");
  if (!apiKey) {
    console.error("缺少 MIMO_API_KEY 环境变量；可在仓库根目录 .env 中配置，不进入版本库。");
    process.exitCode = 1;
    return;
  }
  const outputRoot = isAbsolute(options.outputDirectory)
    ? options.outputDirectory
    : resolve(projectRoot, options.outputDirectory);
  const runDirectory = join(outputRoot, `${options.mode}-${new Date().toISOString().replace(/[:.]/gu, "-")}`);
  await mkdir(join(runDirectory, "audio"), { recursive: true });

  const provider: AiProvider = createNodeOpenAiCompatibleProvider({
    baseUrl,
    apiKey,
    models: { text: MIMO_PRESET.textModel, vision: MIMO_PRESET.textModel },
    supportsJsonObject: true,
    supportsJsonSchema: true,
    asrTransport: "chat-input-audio",
    contextWindowTokens: 32_000,
    // 思考模型生成分镜可能超过默认 90s；harness 只放宽本进程超时，不改产品默认。
    timeoutMs: 180_000,
  });

  const sourceText = "这家推拿店的老师傅手法特别厉害，第一次来就感觉整个人都轻松了，店里环境也很干净，价格还实惠，推荐大家来试试。";
  const analysisRecord = {
    taskId: "task-e2e",
    status: "succeeded" as const,
    result: {
      schemaVersion: "content-analysis.v1",
      document: {
        schemaVersion: "content-analysis.v1",
        source: { taskId: "task-e2e", platform: "douyin", contentType: "video", sourceKind: "asr" },
        overview: { summary: "先呈现顾客痛点，再展示门店服务过程", theme: "门店服务", targetAudiences: ["附近居民"], communicationGoal: "促进到店了解" },
        hook: { type: "pain_point", description: "直接提出选择困难", mechanism: "引发共鸣", evidenceRefs: [] },
        painPoints: [], emotionalDrivers: [], structure: [], coreClaims: [],
        style: { tones: ["真实"], pacing: "紧凑", languagePatterns: ["短句"], interactionMechanisms: [] },
        reusableTemplate: { formula: "痛点-过程-行动", steps: ["提出痛点", "展示过程", "邀请了解"], variableSlots: ["门店服务"], doNotCopy: ["原视频具体措辞"] },
        risks: [],
      },
    },
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
  const taskDetail = {
    task: { id: "task-e2e" },
    content: {},
    media: [],
    transcript: { source: "asr", text: sourceText, segments: [] },
    evidenceUnits: [],
  } as unknown as TaskDetailRecord;

  const values = new Map<string, string>();
  const files = {
    ensureProduction: async ({ projectId }: { readonly projectId: string }) => { ids.add(projectId); },
    writeProductionText: async ({ projectId, relativePath, value }: { readonly projectId: string; readonly relativePath: string; readonly value: string }) => {
      values.set(`${projectId}/${relativePath}`, value);
    },
    readProductionText: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => ({ value: values.get(`${projectId}/${relativePath}`) }),
    listProductionIds: async () => ({ projectIds: [...ids] }),
    deleteProductionFile: async ({ projectId, relativePath }: { readonly projectId: string; readonly relativePath: string }) => {
      values.delete(`${projectId}/${relativePath}`);
    },
    deleteProduction: async ({ projectId }: { readonly projectId: string }) => {
      ids.delete(projectId);
      for (const path of [...values.keys()]) if (path.startsWith(`${projectId}/`)) values.delete(path);
    },
  };
  const ids = new Set<string>();

  const native = {
    pickAssets: async (request: { readonly projectId: string; readonly selection?: "visual" | "avatar" }) => {
      const assets = request.selection === "avatar"
        ? [{ id: "avatar-video", uri: `file:///e2e/${request.projectId}/inputs/avatar-video.mp4`, role: "avatar" as const, kind: "video" as const, mimeType: "video/mp4", displayName: "数字人预处理视频.mp4", sizeBytes: 6_000_000, durationSeconds: 10 }]
        : [
          { id: "asset-front", uri: `file:///e2e/${request.projectId}/inputs/asset-front.jpg`, kind: "image" as const, mimeType: "image/jpeg", displayName: "门店前台.jpg", sizeBytes: 120_000 },
          { id: "asset-room", uri: `file:///e2e/${request.projectId}/inputs/asset-room.jpg`, kind: "image" as const, mimeType: "image/jpeg", displayName: "服务房间.jpg", sizeBytes: 130_000 },
          { id: "asset-detail", uri: `file:///e2e/${request.projectId}/inputs/asset-detail.mp4`, kind: "video" as const, mimeType: "video/mp4", displayName: "服务细节.mp4", sizeBytes: 900_000, durationSeconds: 8 },
        ];
      return { assets };
    },
    consumeAssetOperation: async () => ({ status: "none" as const }),
    render: async () => {
      throw new Error("渲染阶段属 Android Media3，本 harness 不覆盖");
    },
    probeTts: async () => undefined,
    synthesizeNarration: async (request: {
      readonly projectId: string;
      readonly sentences: readonly { readonly sentenceId: string; readonly speechText: string }[];
    }) => {
      const outcomes: { sentenceId: string; durationMs?: number; audioPath?: string; transcribedWords: null; error?: string }[] = [];
      for (const [index, sentence] of request.sentences.entries()) {
        const label = sentence.speechText.length > 18 ? `${sentence.speechText.slice(0, 18)}…` : sentence.speechText;
        try {
          const wav = await synthesizeMiMoWav(baseUrl, apiKey, sentence.speechText);
          const durationMs = wavDurationMs(wav);
          const relativePath = `audio/narration-s-${sentence.sentenceId}.wav`;
          await writeFile(join(runDirectory, relativePath), wav);
          console.log(`  [配音] 句 ${index + 1}/${request.sentences.length} 实测 ${(durationMs / 1000).toFixed(2)}s 「${label}」`);
          outcomes.push({ sentenceId: sentence.sentenceId, durationMs, audioPath: relativePath, transcribedWords: null });
        } catch (error) {
          console.error(`  [配音] 句 ${index + 1}/${request.sentences.length} 失败：「${label}」${error instanceof Error ? error.message : String(error)}`);
          outcomes.push({ sentenceId: sentence.sentenceId, transcribedWords: null, error: "ERR_TTS_SYNTHESIS_FAILED" });
        }
      }
      return { sentences: outcomes };
    },
  };

  const service = new StandaloneProductionService({
    files,
    native,
    analysis: {
      get: async () => analysisRecord,
      run: async () => analysisRecord,
      importVideo: async () => analysisRecord,
      consumeVideoRecovery: async () => ({ status: "none" as const }),
      subscribe: () => () => undefined,
    },
    tasks: { getDetail: async () => taskDetail },
    getProvider: async () => provider,
    getNarrationMode: async () => "provider",
    getNarrationConnection: async () => ({
      ttsTransport: MIMO_PRESET.ttsTransport,
      ttsModel: MIMO_PRESET.ttsModel,
      ttsVoice: MIMO_PRESET.ttsVoice,
      baseUrl,
      asrModel: null,
    }),
    toDisplayUri: (uri: string) => uri,
    createProjectId: () => `e2e-${options.mode}`,
  });

  const summary: HarnessSummary = {
    mode: options.mode,
    startedAt: new Date().toISOString(),
    brief: options.brief,
    targetSeconds: options.targetSeconds,
  };

  try {
    console.log(`[制作 E2E] 模式=${options.mode} 目标=${options.targetSeconds}s 输出=${runDirectory}`);
    await service.create({
      analysisTaskId: "task-e2e",
      brief: options.brief,
      targetDurationSeconds: options.targetSeconds,
      mode: options.mode,
      // create() 的 avatarScript 门禁在 P3 放宽；此处占位以打通链路，不参与 v4 组装。
      ...(options.mode === "avatar" ? { avatarScript: "（预处理数字人视频，口播稿由 AI 分镜生成）" } : {}),
    });
    console.log("[阶段 1/4] 项目已创建，导入素材");
    await service.importAssets(`e2e-${options.mode}`);

    console.log("[阶段 2/4] 生成分镜脚本（真 MiMo API）");
    const script = await service.generateScript(`e2e-${options.mode}`);
    const storyboard = script.storyboard.document as unknown as ScriptStoryboard;
    summary.script = {
      purpose: storyboard.purpose ?? "",
      sentences: storyboard.sentences.map((sentence) => ({
        id: sentence.id,
        text: sentence.text,
        estimatedMs: sentence.estimatedMs,
      })),
    };
    for (const [index, sentence] of storyboard.sentences.entries()) {
      console.log(`  [分镜] 句 ${index + 1}（预估 ${(sentence.estimatedMs / 1000).toFixed(1)}s）：${sentence.text}`);
    }

    console.log("[阶段 3/4] 逐句 MiMo 配音并实测时长");
    const narration = await service.synthesizeNarration(`e2e-${options.mode}`);
    const succeeded = narration.sentences.filter((sentence) => sentence.status === "ready" && sentence.durationMs !== undefined);
    summary.narration = succeeded.map((sentence) => ({
      sentenceId: sentence.sentenceId,
      durationMs: sentence.durationMs!,
    }));
    if (narration.failures.length > 0) {
      throw new Error(`有 ${narration.failures.length} 句配音失败，请检查上方 [配音] 日志`);
    }
    const totalMs = summary.narration.reduce((total, entry) => total + entry.durationMs, 0);
    console.log(`  [配音] 全部完成：${summary.narration.length} 句，总实测 ${(totalMs / 1000).toFixed(2)}s`);

    console.log("[阶段 4/4] 组装实测制作计划（v4）");
    const composed = await service.composeMeasuredPlan(`e2e-${options.mode}`);
    const planPath = join(runDirectory, "plan.json");
    await writeFile(planPath, JSON.stringify(composed.project.plan?.document ?? null, null, 2), "utf8");
    summary.planPath = planPath;
    summary.softViolations = composed.softViolations;
    console.log(`  [组装] 计划已写入 ${planPath}`);
    if (composed.softViolations.length > 0) {
      console.log(`  [组装] 软违规 ${composed.softViolations.length} 条（不阻断）：${composed.softViolations.map((violation) => (violation as { reason?: string }).reason ?? "?").join("、")}`);
    }
    console.log(`[制作 E2E] ${options.mode} 链路全阶段通过（渲染阶段属 Android，不在本 harness 范围）`);
  } catch (error) {
    const issue = error as { code?: string; action?: string; message?: string };
    summary.failure = { code: issue.code, action: issue.action, message: issue.message ?? String(error) };
    console.error(`[制作 E2E] 失败：${summary.failure.code ?? "UNKNOWN"} ${summary.failure.message}`);
    process.exitCode = 1;
  } finally {
    await writeFile(join(runDirectory, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    const projectJson = values.get(`e2e-${options.mode}/project.json`);
    if (projectJson) {
      await writeFile(join(runDirectory, "project.json"), projectJson, "utf8");
    }
    console.log(`[制作 E2E] 产物目录：${runDirectory}`);
  }
}
