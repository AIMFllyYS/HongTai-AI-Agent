import {
  isDecorationId,
  SCRIPT_SENTENCE_MS_PER_CHARACTER,
  type DecorationId,
} from "@hongtai/core";

/**
 * 从流式累积文本中提取出的一句已闭合分镜句（界面投影，不落盘）。
 * 只保留上屏所需字段：正文、贴纸建议与估算时长。
 */
export interface StreamedScriptSentence {
  readonly text: string;
  /** 通过 `isDecorationId` 校验的贴纸建议；供应商给出目录外 id 时视为无贴纸。 */
  readonly stickerId?: DecorationId;
  /** 估算毫秒：流里给了合法 estimatedMs 就用它，缺省按 250ms/字估算（与 core 一致）。 */
  readonly estimatedMs: number;
}

/**
 * 流式 JSON 的容错句子提取（UI 层，不猜半截结构）：
 *
 * 生成中的累积文本是尚未闭合的 JSON（`{"sentences": [ {...}, {...`），界面原则上是
 * 「原始 JSON 不上屏、不渲染半截结构」。这里只做一件安全的事：用括号配对找出文本中
 * 所有**完整闭合**的 `{...}` 段，逐段 `JSON.parse` + 字段校验，通过者视为一句已生成
 * 的分镜句；解析失败、半截未闭合、字段非法一律跳过，绝不猜。
 *
 * - 字符串内的 `{`/`}`/转义引号不参与配对（逐字符扫描，字符串感知）。
 * - 外层根对象即使闭合也没有顶层 `text` 字段，校验自然跳过。
 * - 4000 字符截头保尾后，残留窗口里的闭合句依然能提取；被截掉的头部句不补、不编。
 */
export function extractClosedStreamSentences(content: string): readonly StreamedScriptSentence[] {
  const sentences: StreamedScriptSentence[] = [];
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      stack.push(index);
      continue;
    }
    if (char !== "}") continue;
    const start = stack.pop();
    if (start === undefined) continue;
    const candidate = content.slice(start, index + 1);
    const sentence = parseStreamedSentence(candidate);
    if (sentence) sentences.push(sentence);
  }
  return sentences;
}

/** 单个闭合 `{...}` 段 → 分镜句；不是合法句子（解析失败/正文为空）返回 undefined。 */
function parseStreamedSentence(candidate: string): StreamedScriptSentence | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return undefined;
  const estimatedMs = typeof record.estimatedMs === "number" && Number.isFinite(record.estimatedMs) && record.estimatedMs > 0
    ? Math.round(record.estimatedMs)
    : [...text].length * SCRIPT_SENTENCE_MS_PER_CHARACTER;
  return {
    text,
    ...(isDecorationId(record.stickerId) ? { stickerId: record.stickerId } : {}),
    estimatedMs,
  };
}
