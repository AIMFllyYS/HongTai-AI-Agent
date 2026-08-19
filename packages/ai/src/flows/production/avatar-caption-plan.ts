import {
  buildShotCueTimeline,
  resolveTemplateForPrecision,
  subtitleTimingPrecision,
  TaskError,
  type SubtitleTimingSource,
} from "@hongtai/core";

import type { ProductionPlanResultV3 } from "../../schemas/production-plan";

/**
 * Avatar captions are cut from the pasted script, so nothing about the recorded voice is
 * measured. Boundaries are proportional and the plan says so instead of implying alignment.
 */
const AVATAR_TIMING_SOURCE: SubtitleTimingSource = "script_estimate";

const MAX_SCRIPT_CHARACTERS = 360;
const MAX_CAPTION_CHARACTERS = 32;
const CAPTION_INTERVAL_MS = 5_000;

export interface AvatarCaptionPlanInput {
  readonly analysisTaskId: string;
  readonly brief: string;
  readonly targetDurationSeconds: number;
  readonly avatarScript: string;
  readonly headlineText?: string;
  readonly textPreset: "classic_top" | "clean_card" | "aqua_accent";
  /** Template the user picked; degraded automatically when it needs word-level timing. */
  readonly subtitleTemplateId?: string;
  readonly avatarAsset: {
    readonly id: string;
    readonly durationSeconds?: number;
  };
}

function invalid(message: string): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "edit_input" });
}

function sourceTooShort(targetDurationSeconds: number): TaskError {
  return new TaskError({
    code: "MEDIA_DURATION_EXCEEDED",
    message: `数字人口播视频时长不足 ${targetDurationSeconds} 秒，请选择更长的视频或缩短目标时长。`,
    action: "select_media",
  });
}

function normalizedScript(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function splitScript(value: string, targetParts: number): readonly string[] {
  if (value.length < targetParts) throw invalid("数字人口播稿过短，无法生成与视频时长匹配的字幕。");
  const chunks: string[] = [];
  let remaining = value;
  for (let index = 0; index < targetParts; index += 1) {
    const partsLeft = targetParts - index;
    if (partsLeft === 1) {
      chunks.push(remaining);
      break;
    }
    const maximum = Math.min(MAX_CAPTION_CHARACTERS, remaining.length - (partsLeft - 1));
    const ideal = Math.max(1, Math.min(maximum, Math.round(remaining.length / partsLeft)));
    const punctuation = /[。！？!?；;，,、]/gu;
    let boundary = 0;
    for (const match of remaining.slice(0, ideal).matchAll(punctuation)) boundary = (match.index ?? 0) + match[0].length;
    const end = boundary >= Math.max(2, ideal - 8) ? boundary : ideal;
    const chunk = remaining.slice(0, end).trim();
    if (!chunk) throw invalid("数字人口播稿不能只包含空白字符。");
    chunks.push(chunk);
    remaining = remaining.slice(end).trimStart();
  }
  if (chunks.some((chunk) => chunk.length > MAX_CAPTION_CHARACTERS)) throw invalid("数字人口播稿无法切分为可读字幕，请缩短每句话。");
  return chunks;
}

/**
 * Avatar mode has no AI text-generation step: captions come directly from the
 * user-supplied spoken script, so the original voice and subtitle wording stay
 * aligned even when the provider is unavailable.
 */
export function createAvatarCaptionPlan(input: AvatarCaptionPlanInput): ProductionPlanResultV3 {
  const script = normalizedScript(input.avatarScript);
  if (!input.analysisTaskId.trim() || !input.brief.trim()) throw invalid("数字人口播计划缺少来源任务或制作需求。");
  if (!Number.isInteger(input.targetDurationSeconds) || input.targetDurationSeconds < 15 || input.targetDurationSeconds > 60) {
    throw invalid("数字人口播目标时长必须在15到60秒之间。");
  }
  if (!script) throw invalid("请填写与数字人口播视频一致的口播稿。");
  if (script.length > MAX_SCRIPT_CHARACTERS) throw invalid(`数字人口播稿最多 ${MAX_SCRIPT_CHARACTERS} 个字符，请拆分为多个项目制作。`);
  if (input.avatarAsset.durationSeconds === undefined || input.avatarAsset.durationSeconds + 0.001 < input.targetDurationSeconds) {
    throw sourceTooShort(input.targetDurationSeconds);
  }

  const totalMs = input.targetDurationSeconds * 1_000;
  const targetParts = Math.max(Math.ceil(totalMs / CAPTION_INTERVAL_MS), Math.ceil(script.length / MAX_CAPTION_CHARACTERS));
  if (targetParts > 12) throw invalid("数字人口播稿过长，无法在当前视频时长内生成可读字幕。");
  const captions = splitScript(script, targetParts);
  const baseDurationMs = Math.floor(totalMs / captions.length);
  const remainderMs = totalMs % captions.length;

  const precision = subtitleTimingPrecision(AVATAR_TIMING_SOURCE);
  const resolved = resolveTemplateForPrecision({ requestedId: input.subtitleTemplateId ?? "", precision });

  return {
    schemaVersion: "production-plan.v3",
    source: { analysisTaskId: input.analysisTaskId },
    title: input.brief.trim().slice(0, 80),
    settings: { width: 720, height: 1280, fps: 30, durationSeconds: input.targetDurationSeconds },
    audio: { voiceLocale: "zh-CN", speechRate: 1, backgroundMusicAssetId: null, backgroundMusicVolume: 0 },
    textOverlay: {
      primaryText: input.headlineText?.trim() || input.brief.trim().slice(0, 24),
      secondaryText: null,
      preset: input.textPreset,
    },
    subtitle: {
      templateId: resolved.template.id,
      timing: { precision, source: AVATAR_TIMING_SOURCE },
      degradedFromTemplateId: resolved.degradedFrom ?? null,
    },
    shots: captions.map((caption, index) => {
      const durationMs = baseDurationMs + (index < remainderMs ? 1 : 0);
      return {
        order: index + 1,
        assetId: input.avatarAsset.id,
        durationSeconds: durationMs / 1_000,
        narration: caption,
        caption,
        fit: "contain" as const,
        cues: buildShotCueTimeline({
          text: caption,
          shotDurationMs: durationMs,
          typography: resolved.template.typography,
        }).map((cue) => ({ ...cue, emphasisWords: [...cue.emphasisWords], words: null })),
      };
    }),
    decorations: [],
  };
}
