import { readFile } from "node:fs/promises";
import type { MediaTranscriber, TextRewriter, TranscriptSegment } from "@hongtai/core";

export interface MimoClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly asrModel: string;
  readonly textModel: string;
}

interface ChatResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string };
  }[];
}

const REWRITE_SYSTEM_PROMPT = `你是短视频文稿整理助手。请严格遵守：
1. 只根据原始语音转写整理，不新增任何事实、数字、功效、医学结论或观点；
2. 修复明显错别字和标点，删除无意义口癖，按语义合理分段；
3. 保留原有语气、专有名词、数字和结论；
4. 只输出整理后的正文，不解释处理过程。`;

function parseContent(payload: unknown): string {
  const response = payload as ChatResponse;
  return response.choices?.[0]?.message?.content?.trim() ?? "";
}

export class MimoClient implements MediaTranscriber, TextRewriter {
  readonly #options: MimoClientOptions;

  constructor(options: MimoClientOptions) {
    this.#options = options;
  }

  async transcribe(
    segmentPaths: readonly string[],
    segmentSeconds: number,
    onSegment?: (segment: TranscriptSegment, completed: number, total: number) => void | Promise<void>,
  ): Promise<readonly TranscriptSegment[]> {
    const results: TranscriptSegment[] = [];
    for (let index = 0; index < segmentPaths.length; index += 1) {
      const segmentPath = segmentPaths[index];
      if (!segmentPath) continue;
      let result: TranscriptSegment;
      try {
        const audio = await readFile(segmentPath);
        const payload = await this.#post({
          model: this.#options.asrModel,
          messages: [{
            role: "user",
            content: [{
              type: "input_audio",
              input_audio: { data: `data:audio/wav;base64,${audio.toString("base64")}` },
            }],
          }],
          asr_options: { language: "auto" },
        });
        const text = parseContent(payload);
        if (!text) throw new Error("MiMo ASR返回空文本");
        result = {
          index,
          startSeconds: index * segmentSeconds,
          endSeconds: (index + 1) * segmentSeconds,
          text,
          status: "succeeded",
        };
      } catch (error) {
        result = {
          index,
          startSeconds: index * segmentSeconds,
          endSeconds: (index + 1) * segmentSeconds,
          text: "",
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      results.push(result);
      await onSegment?.(result, index + 1, segmentPaths.length);
    }
    return results;
  }

  async rewrite(transcript: string): Promise<string> {
    const chunks = this.#splitText(transcript, 12_000);
    const results: string[] = [];
    for (const chunk of chunks) {
      const payload = await this.#post({
        model: this.#options.textModel,
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          { role: "user", content: chunk },
        ],
      });
      const text = parseContent(payload);
      if (!text) throw new Error("MiMo文本模型返回空整理稿");
      results.push(text);
    }
    return results.join("\n\n");
  }

  #splitText(text: string, size: number): string[] {
    if (text.length <= size) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > size) {
      const boundary = Math.max(remaining.lastIndexOf("\n", size), remaining.lastIndexOf("。", size));
      const end = boundary > size / 2 ? boundary + 1 : size;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async #post(body: unknown): Promise<unknown> {
    const url = new URL(`${this.#options.baseUrl.replace(/\/+$/, "")}/chat/completions`);
    if (url.protocol !== "https:") throw new Error("MiMo Base URL必须使用HTTPS");
    const delays = [0, 1_000, 3_000];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.#options.apiKey}`,
            "X-Mimo-Source": "hongtai-cli",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        });
        if (response.ok) return await response.json();
        const message = `MiMo请求失败：HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) throw new Error(message);
        lastError = new Error(message);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError.message.includes("HTTP 4") && !lastError.message.includes("HTTP 429")) throw lastError;
      }
    }
    throw lastError ?? new Error("MiMo请求失败");
  }
}
