/**
 * 句级实测 TTS 音轨契约（制作计划 v4 管线的第二阶段产物）。
 *
 * 用户确认分镜文稿后逐句合成配音，这里记录的是真实测得的音频时长与（若 Provider
 * 支持）词级时间戳。v4 计划的每镜时长与字幕 cue 边界都从这里取值；`alignmentSource`
 * 标注时间戳的来路，供 UI 诚实提示精度差异（native 原生返回；whisper_fallback 由
 * Whisper 词级转写反查对齐）。映射到 subtitle-timing 既有精度的规则：有词级时间戳
 * → `asr_word`，仅句级时长 → `tts_duration`。
 */
import type { SubtitleCueWordTiming, SubtitleTimingSource } from "./subtitle-timing";

export const TTS_TIMED_TRACK_CONTRACT_VERSION = "tts-timed-track.v1";

/** 时间戳来路：Provider 原生返回，或 Whisper 词级转写反查（asr-fallback）。 */
export const TTS_TIMING_ALIGNMENT_SOURCES = ["native", "whisper_fallback"] as const;
export type TtsTimingAlignmentSource = (typeof TTS_TIMING_ALIGNMENT_SOURCES)[number];

export interface TtsTimedTrack {
  /** 对应 `ScriptSentence.id`，是音轨与分镜句对回的唯一线索。 */
  readonly sentenceId: string;
  /** 实测音频时长（毫秒）。v4 的每镜时长以它为准，不取字符估算值。 */
  readonly durationMs: number;
  readonly alignmentSource: TtsTimingAlignmentSource;
  /**
   * 词级时间戳，相对本句音频起点。`native` 与 `whisper_fallback` 都可能给出；
   * 缺失时（null 或省略）本句只有句级时长，字幕边界退回比例估算。
   */
  readonly words?: readonly SubtitleCueWordTiming[] | null;
}

/**
 * 把音轨证据映射到 subtitle-timing 的既有时间来源：有词级时间戳就是 `asr_word`
 * （不管是原生还是转写反查），否则只有 `tts_duration`。模板降级决策照旧走
 * `subtitleTimingPrecision`，这里不重复那套规则。
 */
export function timedTrackTimingSource(track: TtsTimedTrack): SubtitleTimingSource {
  return track.words && track.words.length > 0 ? "asr_word" : "tts_duration";
}

/**
 * 实测音轨解析的稳定错误码。UI 与调用方只按 code 分支，中文 message 仅用于展示。
 */
export const TTS_TIMED_TRACK_PARSE_ERROR_CODES = [
  "TTS_TIMED_TRACK_UNREADABLE",
  "TTS_TIMED_TRACK_SENTENCE_ID_INVALID",
  "TTS_TIMED_TRACK_DURATION_INVALID",
  "TTS_TIMED_TRACK_ALIGNMENT_SOURCE_INVALID",
  "TTS_TIMED_TRACK_WORDS_INVALID",
] as const;
export type TtsTimedTrackParseErrorCode = (typeof TTS_TIMED_TRACK_PARSE_ERROR_CODES)[number];

export type TtsTimedTrackParse =
  | { readonly ok: true; readonly value: TtsTimedTrack }
  | { readonly ok: false; readonly code: TtsTimedTrackParseErrorCode; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTtsTimingAlignmentSource(value: unknown): value is TtsTimingAlignmentSource {
  return typeof value === "string" && (TTS_TIMING_ALIGNMENT_SOURCES as readonly string[]).includes(value);
}

/** 解析未知的实测音轨输入；非法输入返回稳定错误码，而不是抛异常。 */
export function parseTtsTimedTrack(value: unknown): TtsTimedTrackParse {
  if (!isRecord(value)) {
    return { ok: false, code: "TTS_TIMED_TRACK_UNREADABLE", message: "实测音轨必须是对象" };
  }
  if (typeof value.sentenceId !== "string" || !value.sentenceId.trim()) {
    return { ok: false, code: "TTS_TIMED_TRACK_SENTENCE_ID_INVALID", message: "实测音轨必须携带有效句子 id" };
  }
  if (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs <= 0) {
    return { ok: false, code: "TTS_TIMED_TRACK_DURATION_INVALID", message: "实测时长必须是正数毫秒" };
  }
  if (!isTtsTimingAlignmentSource(value.alignmentSource)) {
    return {
      ok: false,
      code: "TTS_TIMED_TRACK_ALIGNMENT_SOURCE_INVALID",
      message: "时间戳来路必须是 native 或 whisper_fallback",
    };
  }

  const words = parseWords(value.words, value.durationMs);
  if (!words.ok) return words;

  return {
    ok: true,
    value: {
      sentenceId: value.sentenceId,
      durationMs: value.durationMs,
      alignmentSource: value.alignmentSource,
      ...(words.words ? { words: words.words } : {}),
    },
  };
}

type TimedTrackWordsParse =
  | { readonly ok: true; readonly words?: readonly SubtitleCueWordTiming[] }
  | { readonly ok: false; readonly code: TtsTimedTrackParseErrorCode; readonly message: string };

function parseWords(raw: unknown, durationMs: number): TimedTrackWordsParse {
  if (raw === undefined || raw === null) return { ok: true };
  if (!Array.isArray(raw)) {
    return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间戳必须是数组" };
  }

  const words: SubtitleCueWordTiming[] = [];
  let previousEndMs = 0;
  for (const rawWord of raw) {
    if (!isRecord(rawWord)) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间戳条目必须是对象" };
    }
    const text = typeof rawWord.text === "string" ? rawWord.text.trim() : "";
    const startMs = rawWord.startMs;
    const endMs = rawWord.endMs;
    if (!text) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间戳必须携带非空文本" };
    }
    if (typeof startMs !== "number" || typeof endMs !== "number" || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级起止时间必须是有限数字" };
    }
    if (endMs <= startMs) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间必须是正区间" };
    }
    if (startMs < previousEndMs) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间不能重叠或倒序" };
    }
    if (startMs < 0 || endMs > durationMs) {
      return { ok: false, code: "TTS_TIMED_TRACK_WORDS_INVALID", message: "词级时间必须落在本句实测时长内" };
    }
    previousEndMs = endMs;
    words.push({ text, startMs, endMs });
  }
  return { ok: true, words: words.length > 0 ? words : undefined };
}
