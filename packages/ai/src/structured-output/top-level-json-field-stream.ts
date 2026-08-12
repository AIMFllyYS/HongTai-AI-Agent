import { TaskError } from "@hongtai/core";

export interface CompletedTopLevelJsonField {
  readonly key: string;
  readonly value: unknown;
}

interface ScanResult {
  readonly fields: readonly CompletedTopLevelJsonField[];
  readonly complete: boolean;
}

function invalid(message: string, cause?: unknown): TaskError {
  return new TaskError({
    code: "AI_STRUCTURED_OUTPUT_INVALID",
    message,
    action: "retry",
    ...(cause === undefined ? {} : { cause }),
  });
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
  return index;
}

function stringEnd(source: string, start: number): number | undefined {
  if (source[start] !== '"') throw invalid("AI返回JSON的顶层字段名无效");
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return index + 1;
  }
  return undefined;
}

function valueBoundary(
  source: string,
  start: number,
): { readonly end: number; readonly delimiter: "," | "}" } | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "]") {
      if (depth === 0) throw invalid("AI返回JSON包含未配对的数组边界");
      depth -= 1;
      continue;
    }
    if (character === "}") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      return { end: index, delimiter: "}" };
    }
    if (character === "," && depth === 0) return { end: index, delimiter: "," };
  }
  return undefined;
}

function parseValue(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw invalid("AI返回JSON包含无效的顶层字段值", error);
  }
}

function scan(source: string): ScanResult {
  const fields: CompletedTopLevelJsonField[] = [];
  const keys = new Set<string>();
  let index = skipWhitespace(source, 0);
  let afterComma = false;
  if (index >= source.length) return { fields, complete: false };
  if (source[index] !== "{") throw invalid("AI结构化输出必须是JSON对象");
  index += 1;

  while (true) {
    index = skipWhitespace(source, index);
    if (index >= source.length) return { fields, complete: false };
    if (source[index] === "}") {
      if (afterComma) throw invalid("AI返回JSON的顶层对象不能以逗号结尾");
      index = skipWhitespace(source, index + 1);
      if (index !== source.length) throw invalid("AI结构化输出在JSON对象后包含额外内容");
      return { fields, complete: true };
    }

    const keyStart = index;
    const keyEnd = stringEnd(source, keyStart);
    if (keyEnd === undefined) return { fields, complete: false };
    const key = parseValue(source.slice(keyStart, keyEnd));
    if (typeof key !== "string") throw invalid("AI返回JSON的顶层字段名无效");
    if (keys.has(key)) throw invalid("AI返回JSON包含重复的顶层字段");
    keys.add(key);

    index = skipWhitespace(source, keyEnd);
    if (index >= source.length) return { fields, complete: false };
    if (source[index] !== ":") throw invalid("AI返回JSON的顶层字段缺少冒号");
    index = skipWhitespace(source, index + 1);
    if (index >= source.length) return { fields, complete: false };

    const boundary = valueBoundary(source, index);
    if (!boundary) return { fields, complete: false };
    const valueSource = source.slice(index, boundary.end).trim();
    if (!valueSource) throw invalid("AI返回JSON的顶层字段缺少值");
    fields.push({ key, value: parseValue(valueSource) });
    index = boundary.end + 1;
    afterComma = boundary.delimiter === ",";

    if (boundary.delimiter === "}") {
      index = skipWhitespace(source, index);
      if (index !== source.length) throw invalid("AI结构化输出在JSON对象后包含额外内容");
      return { fields, complete: true };
    }
  }
}

/**
 * Extracts only completed top-level values from one JSON object. It never
 * repairs, guesses or emits a partial string/object, and bounds retained text.
 */
export class TopLevelJsonFieldStream {
  readonly #selectedKeys: ReadonlySet<string>;
  readonly #maxCharacters: number;
  readonly #emittedKeys = new Set<string>();
  #source = "";
  #finished = false;

  constructor(selectedKeys: readonly string[], maxCharacters = 128_000) {
    this.#selectedKeys = new Set(selectedKeys);
    this.#maxCharacters = maxCharacters;
  }

  push(chunk: string): readonly CompletedTopLevelJsonField[] {
    if (this.#finished) throw invalid("AI结构化输出流已经结束");
    this.#source += chunk;
    if (this.#source.length > this.#maxCharacters) throw invalid("AI结构化输出超过安全长度限制");
    return this.#newSelectedFields(scan(this.#source));
  }

  finish(): readonly CompletedTopLevelJsonField[] {
    if (this.#finished) return [];
    this.#finished = true;
    const result = scan(this.#source);
    if (!result.complete) throw invalid("AI结构化输出在JSON闭合前结束");
    return this.#newSelectedFields(result);
  }

  #newSelectedFields(result: ScanResult): readonly CompletedTopLevelJsonField[] {
    const selected: CompletedTopLevelJsonField[] = [];
    for (const field of result.fields) {
      if (!this.#selectedKeys.has(field.key) || this.#emittedKeys.has(field.key)) continue;
      this.#emittedKeys.add(field.key);
      selected.push(field);
    }
    return selected;
  }
}
