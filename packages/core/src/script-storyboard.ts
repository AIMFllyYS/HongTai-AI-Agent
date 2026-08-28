/**
 * 文稿先行的分镜脚本契约（制作计划 v4 管线的第一阶段产物）。
 *
 * v3 是「时长先行」：先选预设时长，再让镜头总和精确凑满。v4 倒置为「文稿先行」：
 * 先逐句写口播文案，每句的时长最终由实测 TTS 音频决定。这里的 `estimatedMs` 只是
 * 字符估算，用于生成阶段向用户实时展示预估总时长；它从不冒充实测，也不会进入渲染。
 */
import { isDecorationId, type DecorationId } from "./decoration";

export const SCRIPT_STORYBOARD_CONTRACT_VERSION = "script-storyboard.v1";

/**
 * 单句口播文案的长度上限，与 v3 计划里每镜 narration 的上限一致：分镜句最终会
 * 成为一镜的口播，提前在契约处拒绝超长句，免得后面才被迫删字。
 */
export const MAX_SCRIPT_SENTENCE_CHARACTERS = 160;

/**
 * 字符估算的每字符毫秒数（中文口播常速约 4 字/秒）。这是诚实的近似值：它只用于
 * 生成阶段的预估展示，真实时长永远以 `TtsTimedTrack.durationMs` 为准。
 */
export const SCRIPT_SENTENCE_MS_PER_CHARACTER = 250;

export interface ScriptSentence {
  /** 调用方生成的稳定 id；后续 TTS 音轨与字幕都靠它对回这句话。 */
  readonly id: string;
  /** 口播文案，逐字进入字幕，不得为空或超过上限。 */
  readonly text: string;
  /** 素材绑定建议：引用项目内已导入素材的标识（`ProductionAsset.id`），由调用方校验存在性。 */
  readonly assetId?: string;
  /** 贴纸建议：内置装饰清单 id，渲染层据此取图。 */
  readonly stickerId?: DecorationId;
  /** 预估时长（毫秒），按字符估算得出，仅供生成阶段展示。 */
  readonly estimatedMs: number;
}

export interface ScriptStoryboard {
  readonly schemaVersion: "script-storyboard.v1";
  readonly sentences: readonly ScriptSentence[];
  /** 整体生成用途说明（例如「门店服务介绍」），供界面回显，不参与渲染。 */
  readonly purpose?: string;
}

/** 按字符数估算一句口播的毫秒时长；空文本估为 0，由解析层负责拒绝。 */
export function estimateScriptSentenceMs(text: string): number {
  const characters = [...text.trim()].length;
  return characters * SCRIPT_SENTENCE_MS_PER_CHARACTER;
}

/** 预估总时长 = Σ 每句 estimatedMs，四舍五入到整毫秒。 */
export function scriptStoryboardEstimatedTotalMs(storyboard: ScriptStoryboard): number {
  return storyboard.sentences.reduce(
    (sum, sentence) => sum + Math.round(sentence.estimatedMs),
    0,
  );
}

/**
 * 分镜脚本解析的稳定错误码。UI 与调用方只按 code 分支，中文 message 仅用于展示。
 */
export const SCRIPT_STORYBOARD_PARSE_ERROR_CODES = [
  "SCRIPT_STORYBOARD_UNREADABLE",
  "SCRIPT_STORYBOARD_VERSION_UNSUPPORTED",
  "SCRIPT_STORYBOARD_SENTENCES_INVALID",
  "SCRIPT_STORYBOARD_SENTENCE_INVALID",
  "SCRIPT_STORYBOARD_SENTENCE_ID_DUPLICATED",
  "SCRIPT_STORYBOARD_PURPOSE_INVALID",
] as const;
export type ScriptStoryboardParseErrorCode = (typeof SCRIPT_STORYBOARD_PARSE_ERROR_CODES)[number];

export type ScriptStoryboardParse =
  | { readonly ok: true; readonly value: ScriptStoryboard }
  | { readonly ok: false; readonly code: ScriptStoryboardParseErrorCode; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析未知的 storyboard 输入；非法输入返回稳定错误码，而不是抛异常。 */
export function parseScriptStoryboard(value: unknown): ScriptStoryboardParse {
  if (!isRecord(value)) {
    return { ok: false, code: "SCRIPT_STORYBOARD_UNREADABLE", message: "分镜脚本必须是对象" };
  }
  if (value.schemaVersion !== "script-storyboard.v1") {
    return {
      ok: false,
      code: "SCRIPT_STORYBOARD_VERSION_UNSUPPORTED",
      message: "分镜脚本版本不受支持",
    };
  }
  if (!Array.isArray(value.sentences) || value.sentences.length === 0) {
    return {
      ok: false,
      code: "SCRIPT_STORYBOARD_SENTENCES_INVALID",
      message: "分镜脚本必须包含至少一句口播",
    };
  }
  if (value.purpose !== undefined && (typeof value.purpose !== "string" || !value.purpose.trim())) {
    return { ok: false, code: "SCRIPT_STORYBOARD_PURPOSE_INVALID", message: "分镜用途说明必须是非空文本" };
  }

  const sentences: ScriptSentence[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of value.sentences.entries()) {
    const sentence = parseSentence(raw, index);
    if (!sentence.ok) return sentence;
    if (seenIds.has(sentence.value.id)) {
      return {
        ok: false,
        code: "SCRIPT_STORYBOARD_SENTENCE_ID_DUPLICATED",
        message: `第 ${index + 1} 句的 id「${sentence.value.id}」重复，句子 id 必须唯一`,
      };
    }
    seenIds.add(sentence.value.id);
    sentences.push(sentence.value);
  }

  return {
    ok: true,
    value: {
      schemaVersion: "script-storyboard.v1",
      sentences,
      ...(typeof value.purpose === "string" && value.purpose.trim() ? { purpose: value.purpose } : {}),
    },
  };
}

type ScriptSentenceParse =
  | { readonly ok: true; readonly value: ScriptSentence }
  | { readonly ok: false; readonly code: ScriptStoryboardParseErrorCode; readonly message: string };

function parseSentence(raw: unknown, index: number): ScriptSentenceParse {
  if (!isRecord(raw)) {
    return {
      ok: false,
      code: "SCRIPT_STORYBOARD_SENTENCE_INVALID",
      message: `第 ${index + 1} 句必须是对象`,
    };
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    return { ok: false, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID", message: `第 ${index + 1} 句缺少有效 id` };
  }
  if (typeof raw.text !== "string" || !raw.text.trim()) {
    return { ok: false, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID", message: `第 ${index + 1} 句口播文案不能为空` };
  }
  if ([...raw.text].length > MAX_SCRIPT_SENTENCE_CHARACTERS) {
    return {
      ok: false,
      code: "SCRIPT_STORYBOARD_SENTENCE_INVALID",
      message: `第 ${index + 1} 句口播文案超过 ${MAX_SCRIPT_SENTENCE_CHARACTERS} 字上限`,
    };
  }
  if (raw.assetId !== undefined && (typeof raw.assetId !== "string" || !raw.assetId.trim())) {
    return { ok: false, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID", message: `第 ${index + 1} 句素材绑定建议必须是有效标识` };
  }
  if (raw.stickerId !== undefined && !isDecorationId(raw.stickerId)) {
    return {
      ok: false,
      code: "SCRIPT_STORYBOARD_SENTENCE_INVALID",
      message: `第 ${index + 1} 句贴纸建议「${String(raw.stickerId)}」不在内置装饰清单中`,
    };
  }
  if (typeof raw.estimatedMs !== "number" || !Number.isFinite(raw.estimatedMs) || raw.estimatedMs <= 0) {
    return { ok: false, code: "SCRIPT_STORYBOARD_SENTENCE_INVALID", message: `第 ${index + 1} 句预估时长必须是正数` };
  }

  return {
    ok: true,
    value: {
      id: raw.id,
      text: raw.text,
      ...(typeof raw.assetId === "string" && raw.assetId.trim() ? { assetId: raw.assetId } : {}),
      ...(isDecorationId(raw.stickerId) ? { stickerId: raw.stickerId } : {}),
      estimatedMs: raw.estimatedMs,
    },
  };
}
