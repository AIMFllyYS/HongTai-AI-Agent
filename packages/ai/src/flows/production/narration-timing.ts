/**
 * TTS 时间戳适配层（制作计划 v4「文稿先行」管线的配音阶段策略）。
 *
 * 云端 TTS 的实际 HTTP 调用在 Android Kotlin 层（CloudNarrationSynthesizer），由连接配置
 * 的 ttsModel/ttsTransport/ttsVoice 决定指令形态；本模块只做纯 TS 策略，不做任何网络
 * I/O，包含三部分：
 *
 * 1. Provider 能力映射：provider/transport 标识 → 是否原生返回词级时间戳；
 * 2. 逐句配音指令计划：把分镜句列表翻译成 Kotlin 可执行的合成与转写指令（含不改变
 *    朗读语义的文本预清洗与替换映射记录）；
 * 3. Whisper 词对齐纯函数：把 Kotlin 回传的原始转写词列表对齐成 core 的 TtsTimedTrack
 *    契约（alignmentSource='whisper_fallback'）。
 *
 * 对齐从不伪造精确值：每个原文词要么取到转写实测时间（transcribed），要么用邻词插值
 * 并在对齐报告中标注（interpolated）。
 */
import type {
  ScriptSentence,
  SubtitleCueWordTiming,
  TtsTimedTrack,
  TtsTimingAlignmentSource,
} from "@hongtai/core";

/* ============================== 稳定错误码 ============================== */

/**
 * 本模块的稳定错误码。UI 与调用方只按 code 分支，中文 message 仅用于展示。
 */
export const NARRATION_TIMING_ERROR_CODES = [
  "NARRATION_TIMING_SENTENCES_INVALID",
  "NARRATION_TIMING_SENTENCE_INVALID",
  "NARRATION_TIMING_SENTENCE_ID_INVALID",
  "NARRATION_TIMING_SENTENCE_ID_DUPLICATED",
  "NARRATION_TIMING_CONNECTION_INVALID",
  "NARRATION_TIMING_TEXT_INVALID",
  "NARRATION_TIMING_DURATION_INVALID",
  "NARRATION_TIMING_TRANSCRIPT_EMPTY",
  "NARRATION_TIMING_TRANSCRIPT_INVALID",
] as const;
export type NarrationTimingErrorCode = (typeof NARRATION_TIMING_ERROR_CODES)[number];

export type NarrationTimingPlanParse =
  | { readonly ok: true; readonly value: NarrationTimingInstructionPlan }
  | { readonly ok: false; readonly code: NarrationTimingErrorCode; readonly message: string };

export type NarrationWhisperAlignmentParse =
  | { readonly ok: true; readonly value: NarrationWhisperAlignment }
  | { readonly ok: false; readonly code: NarrationTimingErrorCode; readonly message: string };

/* ========================= 第一部分：Provider 能力映射 ========================= */

/** 单个 TTS provider/transport 的词级时间戳能力。 */
export interface TtsProviderTimingCapability {
  /** Provider 是否直接返回词级（或字符级）时间戳；false 表示需要 Whisper 转写反查。 */
  readonly nativeWordTimestamps: boolean;
}

/**
 * 已登记的 provider/transport 能力表，key 与 core `AiTtsTransport` 标识一致。
 *
 * 现状：miMo（mimo-chat-audio）、stepFun（stepfun-audio-speech）以及一般 OpenAI 兼容
 * TTS 均不返回词级时间戳。未来出现原生时间戳 provider 时在表中加一行登记即可，
 * 查询函数对未登记标识一律保守回退，绝不假设有能力。
 */
export const TTS_PROVIDER_TIMING_CAPABILITIES: Readonly<Record<string, TtsProviderTimingCapability>> = Object.freeze({
  "mimo-chat-audio": { nativeWordTimestamps: false },
  "stepfun-audio-speech": { nativeWordTimestamps: false },
});

/** 查询 provider/transport 的词级时间戳能力；未登记时保守按「无原生时间戳」处理。 */
export function ttsProviderTimingCapability(ttsTransport: string): TtsProviderTimingCapability {
  return TTS_PROVIDER_TIMING_CAPABILITIES[ttsTransport] ?? { nativeWordTimestamps: false };
}

/* ========================= 第二部分：文本预清洗与指令计划 ========================= */

/**
 * 已知会导致 Whisper 词边界碎裂的符号及其中文读音等价物。替换只改读音呈现，不改语义，
 * 句子本身不改写。
 */
export const NARRATION_SPEECH_SYMBOL_SUBSTITUTIONS: readonly {
  readonly original: string;
  readonly replacement: string;
}[] = Object.freeze([{ original: "&", replacement: "和" }]);

/** 一次符号替换的记录；index 为该符号在清洗前原句文本中的码点位置，供对齐时回查。 */
export interface NarrationSpeechReplacement {
  readonly original: string;
  readonly replacement: string;
  readonly index: number;
}

/** 预清洗结果：朗读文本 + 替换映射记录。 */
export interface NarrationSpeechCleaning {
  readonly speechText: string;
  readonly replacements: readonly NarrationSpeechReplacement[];
}

/** 已知不可见字符（零宽、BOM、软连字符、方向控制等），朗读与转写中都应剔除。 */
const INVISIBLE_CHARACTERS = new Set([
  "\u00ad",
  "\u200b",
  "\u200c",
  "\u200d",
  "\u200e",
  "\u200f",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
  "\u2060",
  "\ufeff",
]);

/** 全角 ASCII 区与全角空格归一到半角；朗读语义不变，只改善转写的词边界稳健性。 */
function toHalfWidthCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCodePoint(code - 0xfee0);
  if (code === 0x3000) return " ";
  return character;
}

/**
 * 朗读文本预清洗：不可见字符剔除、全半角归一、已知碎裂符号替换为读音等价物、连续空白
 * 压缩。只影响 Whisper 反查场景的稳健性；句子内容词不改写，替换逐条记录供对齐回查。
 */
export function cleanNarrationSpeechText(text: string): NarrationSpeechCleaning {
  const replacements: NarrationSpeechReplacement[] = [];
  let speech = "";
  for (const [index, character] of [...text].entries()) {
    if (INVISIBLE_CHARACTERS.has(character)) continue;
    const normalized = toHalfWidthCharacter(character);
    const substitution = NARRATION_SPEECH_SYMBOL_SUBSTITUTIONS.find((rule) => rule.original === normalized);
    if (substitution) {
      replacements.push({ original: substitution.original, replacement: substitution.replacement, index });
      speech += substitution.replacement;
      continue;
    }
    speech += normalized;
  }
  return { speechText: speech.replace(/\s+/gu, " ").trim(), replacements };
}

/** 配音模式：蒙太奇（逐句云端合成）或口播切片（用户自带口播音视频）。 */
export type NarrationTimingMode = "montage" | "avatar";

/** 云端 TTS 连接描述（来自连接配置 ttsModel/ttsTransport/ttsVoice 的只读快照）。 */
export interface NarrationTimingConnection {
  readonly ttsTransport: string;
  readonly ttsModel?: string | null;
  readonly ttsVoice?: string | null;
}

/** 单句配音指令：Kotlin 侧据此合成音频并按策略决定是否请求转写反查。 */
export interface NarrationSentenceTimingInstruction {
  readonly sentenceId: string;
  /** 经文本预清洗后的朗读文本（语义与原句一致）。 */
  readonly speechText: string;
  /** 词级时间戳获取策略：Provider 原生返回，或 Whisper 转写反查。 */
  readonly strategy: TtsTimingAlignmentSource;
  /** 是否需要把合成音频送转写端点反查词级时间戳。 */
  readonly needsTranscription: boolean;
  /** 预清洗的替换映射；对齐时用于把原文符号映射回读音等价物。 */
  readonly replacements: readonly NarrationSpeechReplacement[];
}

export interface NarrationTimingInstructionPlan {
  readonly mode: NarrationTimingMode;
  readonly sentences: readonly NarrationSentenceTimingInstruction[];
}

export interface NarrationTimingPlanInput {
  readonly mode: NarrationTimingMode;
  readonly sentences: readonly ScriptSentence[];
  /** 云端 TTS 连接描述；口播切片（avatar）模式音频来自用户素材，可省略。 */
  readonly connection?: NarrationTimingConnection | null;
}

/**
 * 构造逐句配音指令计划。策略分派：
 * - 蒙太奇：按能力表决定 native / whisper_fallback；连接缺失即失败（必须逐句合成）；
 * - 口播切片：音频来自用户素材、无法原生给词级时间戳，固定 whisper_fallback。
 */
export function buildNarrationTimingInstructionPlan(input: NarrationTimingPlanInput): NarrationTimingPlanParse {
  if (!Array.isArray(input.sentences) || input.sentences.length === 0) {
    return { ok: false, code: "NARRATION_TIMING_SENTENCES_INVALID", message: "逐句配音计划必须包含至少一句口播" };
  }

  let strategy: TtsTimingAlignmentSource;
  if (input.mode === "avatar") {
    strategy = "whisper_fallback";
  } else {
    const transport = input.connection?.ttsTransport;
    if (typeof transport !== "string" || !transport.trim()) {
      return {
        ok: false,
        code: "NARRATION_TIMING_CONNECTION_INVALID",
        message: "蒙太奇逐句配音必须提供 TTS 连接的 transport 标识",
      };
    }
    strategy = ttsProviderTimingCapability(transport).nativeWordTimestamps ? "native" : "whisper_fallback";
  }
  const needsTranscription = strategy === "whisper_fallback";

  const instructions: NarrationSentenceTimingInstruction[] = [];
  const seenIds = new Set<string>();
  for (const [index, sentence] of input.sentences.entries()) {
    if (typeof sentence.id !== "string" || !sentence.id.trim()) {
      return {
        ok: false,
        code: "NARRATION_TIMING_SENTENCE_ID_INVALID",
        message: `第 ${index + 1} 句缺少有效 id`,
      };
    }
    if (seenIds.has(sentence.id)) {
      return {
        ok: false,
        code: "NARRATION_TIMING_SENTENCE_ID_DUPLICATED",
        message: `第 ${index + 1} 句的 id「${sentence.id}」重复，句子 id 必须唯一`,
      };
    }
    if (typeof sentence.text !== "string" || !sentence.text.trim()) {
      return {
        ok: false,
        code: "NARRATION_TIMING_SENTENCE_INVALID",
        message: `第 ${index + 1} 句口播文案不能为空`,
      };
    }
    const cleaning = cleanNarrationSpeechText(sentence.text);
    if (!cleaning.speechText) {
      return {
        ok: false,
        code: "NARRATION_TIMING_SENTENCE_INVALID",
        message: `第 ${index + 1} 句口播文案清洗后没有可朗读内容`,
      };
    }
    seenIds.add(sentence.id);
    instructions.push({
      sentenceId: sentence.id,
      speechText: cleaning.speechText,
      strategy,
      needsTranscription,
      replacements: cleaning.replacements,
    });
  }

  return { ok: true, value: { mode: input.mode, sentences: instructions } };
}

/* ========================= 第三部分：Whisper 词对齐纯函数 ========================= */

/** Kotlin 侧回传的 Whisper 原始词条目格式（简单入参类型，时间相对本句音频起点）。 */
export interface WhisperTranscribedWord {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** 词级时间的来源：转写实测，或邻词插值（诚实标注，不伪造精确值）。 */
export type NarrationWordTimingOrigin = "transcribed" | "interpolated";

/** 对齐报告中与 track.words 逐项平行的词级明细。 */
export interface NarrationWordAlignmentDetail extends SubtitleCueWordTiming {
  readonly origin: NarrationWordTimingOrigin;
}

export interface NarrationWhisperAlignment {
  readonly track: TtsTimedTrack;
  /** 与 track.words 同长同序，标注每个词的时间来源。 */
  readonly words: readonly NarrationWordAlignmentDetail[];
  readonly matchedWordCount: number;
  readonly interpolatedWordCount: number;
}

export interface NarrationWhisperAlignmentInput {
  readonly sentenceId: string;
  /** 原句文本（清洗前）；输出 words 的文本取自这里，保证与字幕文案逐字一致。 */
  readonly text: string;
  /** 预清洗产生的替换映射；可为空数组。 */
  readonly replacements?: readonly NarrationSpeechReplacement[];
  readonly transcribedWords: readonly WhisperTranscribedWord[];
  /** 实测音频时长（毫秒），显式入参；调用方自行决定是否用转写末词 endMs 上取整。 */
  readonly durationMs: number;
}

/**
 * 取转写词列表末尾词 endMs 的上取整值，供调用方显式选择是否作为 durationMs 传入；
 * 空列表返回 0（空列表场景对齐函数本身会返回 TRANSCRIPT_EMPTY）。
 */
export function whisperTranscriptEndMs(transcribedWords: readonly WhisperTranscribedWord[]): number {
  const last = transcribedWords[transcribedWords.length - 1];
  return Math.ceil(last?.endMs ?? 0);
}

/** 原文 token：中文逐字、拉丁/全角字母数字按连续串成词、其余非空白单字符为符号词。 */
interface NarrationTimingToken {
  readonly text: string;
  /** 在清洗前原句文本中的码点起始位置，与替换映射的 index 同一坐标系。 */
  readonly index: number;
  readonly kind: "cjk" | "alnum" | "symbol";
}

const NARRATION_TOKEN_PATTERN = /[\p{Script=Han}]|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

/** 匹配窗口（字符数）：容忍转写在原文词之间插入少量多出的词。 */
const ALIGNMENT_SEARCH_WINDOW_CHARACTERS = 24;

function isInvisibleCharacter(character: string): boolean {
  return INVISIBLE_CHARACTERS.has(character);
}

function tokenizeNarrationText(text: string): readonly NarrationTimingToken[] {
  const tokens: NarrationTimingToken[] = [];
  for (const match of text.matchAll(NARRATION_TOKEN_PATTERN)) {
    const tokenText = match[0];
    if ([...tokenText].every(isInvisibleCharacter)) continue;
    const index = [...text.slice(0, match.index ?? 0)].length;
    tokens.push({ text: tokenText, index, kind: narrationTokenKind(tokenText) });
  }
  return tokens;
}

function narrationTokenKind(text: string): NarrationTimingToken["kind"] {
  if (/^[\p{Script=Han}]$/u.test(text)) return "cjk";
  if (/^[\p{L}\p{N}]+$/u.test(text)) return "alnum";
  return "symbol";
}

/** 原文词的匹配形式：全半角归一 + 小写 + 去空白（内容词保留原文形态）。 */
function normalizeSourceForm(text: string): string {
  return [...text]
    .filter((character) => !isInvisibleCharacter(character))
    .map(toHalfWidthCharacter)
    .join("")
    .toLowerCase()
    .replace(/\s+/gu, "");
}

/** 转写词的匹配形式：全半角归一 + 小写 + 剥离空白与标点符号。 */
function normalizeTranscriptForm(word: string): string {
  return [...word]
    .map(toHalfWidthCharacter)
    .join("")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

interface NormalizedTranscriptWord {
  readonly form: string;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * 转写字符流：归一化词拼接而成，anchors 记录每个字符来自哪个转写词的第几个字符。
 * anchors 与 chars 的 UTF-16 code unit 一一对齐（非 BMP 字符占两格，指向同一偏移），
 * 这样 indexOf 返回的位置可以直接用于 anchors 查询。
 */
interface TranscriptCharStream {
  readonly chars: string;
  readonly anchors: readonly { readonly wordIndex: number; readonly offsetInWord: number }[];
}

function buildTranscriptCharStream(words: readonly NormalizedTranscriptWord[]): TranscriptCharStream {
  let chars = "";
  const anchors: { wordIndex: number; offsetInWord: number }[] = [];
  for (const [wordIndex, word] of words.entries()) {
    for (const [offsetInWord, character] of [...word.form].entries()) {
      chars += character;
      for (let unit = 0; unit < character.length; unit += 1) {
        anchors.push({ wordIndex, offsetInWord });
      }
    }
  }
  return { chars, anchors };
}

/** 转写词内按字符比例细分出的时间点；offset 取 0..formLength。 */
function charOffsetTimeMs(word: NormalizedTranscriptWord, offsetInWord: number): number {
  const formLength = [...word.form].length;
  if (formLength <= 1) return offsetInWord === 0 ? word.startMs : word.endMs;
  return word.startMs + ((word.endMs - word.startMs) * offsetInWord) / formLength;
}

/** token 在字符流中的覆盖区间 [startChar, endChar)。 */
interface CharRange {
  readonly startChar: number;
  readonly endChar: number;
}

function findOccurrenceWithinWindow(chars: string, form: string, from: number, limit: number): number {
  const found = chars.indexOf(form, from);
  return found !== -1 && found + form.length <= limit ? found : -1;
}

/**
 * 把 Kotlin 回传的 Whisper 原始词列表对齐成 TtsTimedTrack（alignmentSource=
 * 'whisper_fallback'）。
 *
 * 对齐算法：原文 token（中文逐字、英文按词）与转写归一化字符流做顺序滑窗匹配——在
 * 窗口内找原文词形式的首次出现，天然容忍转写多字（窗口跳过）、漏字（未匹配转插值）、
 * 拆字与合并词（字符流拼接后按所属转写词做词内比例细分）。每个匹配词的时间取覆盖到的
 * 转写词区间（跨词时取首词细分起点到尾词细分终点）；未匹配词用邻词插值并在报告中标注
 * interpolated；时间倒挂等异常输入由确定性的单调化修复兜住，保证产物满足
 * parseTtsTimedTrack 的全部不变量。
 */
export function alignNarrationWordsWithWhisper(input: NarrationWhisperAlignmentInput): NarrationWhisperAlignmentParse {
  if (typeof input.sentenceId !== "string" || !input.sentenceId.trim()) {
    return { ok: false, code: "NARRATION_TIMING_SENTENCE_ID_INVALID", message: "对齐必须携带有效句子 id" };
  }
  if (typeof input.text !== "string" || !input.text.trim()) {
    return { ok: false, code: "NARRATION_TIMING_TEXT_INVALID", message: "对齐的原句文本不能为空" };
  }
  if (typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 1) {
    return { ok: false, code: "NARRATION_TIMING_DURATION_INVALID", message: "实测时长必须是不小于 1 毫秒的有限数字" };
  }
  if (!Array.isArray(input.transcribedWords) || input.transcribedWords.length === 0) {
    return { ok: false, code: "NARRATION_TIMING_TRANSCRIPT_EMPTY", message: "转写词列表为空，无法反查词级时间戳" };
  }

  const normalizedWords: NormalizedTranscriptWord[] = [];
  for (const [index, transcribed] of input.transcribedWords.entries()) {
    if (
      typeof transcribed?.word !== "string" ||
      typeof transcribed.startMs !== "number" ||
      typeof transcribed.endMs !== "number" ||
      !Number.isFinite(transcribed.startMs) ||
      !Number.isFinite(transcribed.endMs) ||
      transcribed.endMs <= transcribed.startMs ||
      transcribed.startMs < 0 ||
      transcribed.endMs > input.durationMs
    ) {
      return {
        ok: false,
        code: "NARRATION_TIMING_TRANSCRIPT_INVALID",
        message: `第 ${index + 1} 个转写词条目非法（需要正区间且落在本句实测时长内）`,
      };
    }
    const form = normalizeTranscriptForm(transcribed.word);
    if (form) normalizedWords.push({ form, startMs: transcribed.startMs, endMs: transcribed.endMs });
  }
  if (normalizedWords.length === 0) {
    return { ok: false, code: "NARRATION_TIMING_TRANSCRIPT_INVALID", message: "转写词全部是标点或空白，没有可对齐内容" };
  }

  const tokens = tokenizeNarrationText(input.text);
  if (tokens.length === 0) {
    return { ok: false, code: "NARRATION_TIMING_TEXT_INVALID", message: "原句文本没有可切分的词" };
  }
  const replacements = input.replacements ?? [];
  const stream = buildTranscriptCharStream(normalizedWords);

  // 顺序滑窗匹配：每个原文词在字符流窗口内找首次出现，并立即换算成时间——覆盖区间
  // 首字符的细分起点到末字符的细分终点（跨词时取首词细分起点到尾词细分终点）。
  const matches: (CharRange | undefined)[] = new Array<CharRange | undefined>(tokens.length).fill(undefined);
  const timings: ({ readonly startMs: number; readonly endMs: number } | undefined)[] = tokens.map(() => undefined);
  let streamCursor = 0;
  for (const [tokenIndex, token] of tokens.entries()) {
    const form = tokenAlignmentForm(token, replacements);
    if (!form) continue;
    const searchLimit = Math.min(streamCursor + ALIGNMENT_SEARCH_WINDOW_CHARACTERS, stream.chars.length);
    const position = findOccurrenceWithinWindow(stream.chars, form, streamCursor, searchLimit);
    if (position === -1) continue;
    const first = stream.anchors[position];
    const last = stream.anchors[position + form.length - 1];
    const firstWord = first ? normalizedWords[first.wordIndex] : undefined;
    const lastWord = last ? normalizedWords[last.wordIndex] : undefined;
    if (!first || !last || !firstWord || !lastWord) continue;
    matches[tokenIndex] = { startChar: position, endChar: position + form.length };
    timings[tokenIndex] = {
      startMs: charOffsetTimeMs(firstWord, first.offsetInWord),
      endMs: charOffsetTimeMs(lastWord, last.offsetInWord + 1),
    };
    streamCursor = position + form.length;
  }

  // 未匹配词用邻词插值：段首锚点取前一词 endMs（开头段取 0），段尾锚点取后一匹配词
  // startMs（结尾段取 durationMs）；空间为正时均分，为零时退化为逐词 1ms 连排并交给
  // 单调化修复，绝不冒充转写实测值。
  let index = 0;
  while (index < tokens.length) {
    if (timings[index] !== undefined) {
      index += 1;
      continue;
    }
    let segmentEnd = index;
    while (segmentEnd < tokens.length && timings[segmentEnd] === undefined) segmentEnd += 1;
    const anchorStart = index > 0 ? timings[index - 1]!.endMs : 0;
    const anchorEnd = segmentEnd < tokens.length ? timings[segmentEnd]!.startMs : input.durationMs;
    const count = segmentEnd - index;
    const span = anchorEnd - anchorStart;
    for (let offset = 0; offset < count; offset += 1) {
      const startMs = span > 0 ? anchorStart + (span * offset) / count : anchorStart + offset;
      const width = span > 0 ? span / count : 1;
      timings[index + offset] = { startMs, endMs: startMs + width };
    }
    index = segmentEnd;
  }

  // 单调化 + 边界收敛：保证正区间、不重叠不倒序、落在 [0, durationMs] 内，产物因此
  // 可以直接通过 parseTtsTimedTrack 的校验。正常输入下词的数值不会被改动；只有转写
  // 时间倒挂等异常输入才会被确定性地正向推进再反向收缩。
  const ranges = timings.map((timing) => ({ startMs: timing!.startMs, endMs: timing!.endMs }));
  let cursor = 0;
  for (const range of ranges) {
    range.startMs = Math.max(range.startMs, cursor);
    range.endMs = Math.max(range.endMs, range.startMs + 1);
    cursor = range.endMs;
  }
  for (let rangeIndex = ranges.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
    const range = ranges[rangeIndex]!;
    const upperBound = rangeIndex === ranges.length - 1 ? input.durationMs : ranges[rangeIndex + 1]!.startMs;
    range.endMs = Math.min(range.endMs, upperBound);
    range.startMs = Math.max(0, Math.min(range.startMs, range.endMs - 1));
  }

  const words: NarrationWordAlignmentDetail[] = tokens.map((token, tokenIndex) => ({
    text: token.text,
    startMs: ranges[tokenIndex]!.startMs,
    endMs: ranges[tokenIndex]!.endMs,
    origin: matches[tokenIndex] !== undefined ? "transcribed" : "interpolated",
  }));

  const matchedWordCount = matches.filter((match) => match !== undefined).length;
  return {
    ok: true,
    value: {
      track: {
        sentenceId: input.sentenceId,
        durationMs: input.durationMs,
        alignmentSource: "whisper_fallback",
        words: words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
      },
      words,
      matchedWordCount,
      interpolatedWordCount: words.length - matchedWordCount,
    },
  };
}

/** 原文词的匹配形式；无替换映射的符号词（标点等）不参与转写匹配，直接走插值。 */
function tokenAlignmentForm(token: NarrationTimingToken, replacements: readonly NarrationSpeechReplacement[]): string {
  if (token.kind === "symbol") {
    const tokenLength = [...token.text].length;
    const replacement = replacements.find(
      (entry) => entry.index >= token.index && entry.index < token.index + tokenLength,
    );
    return replacement ? normalizeSourceForm(replacement.replacement) : "";
  }
  return normalizeSourceForm(token.text);
}
