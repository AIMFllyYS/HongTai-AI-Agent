import { readFile } from "node:fs/promises";
import { TaskError, issueFromError, type MediaTranscriber, type TextRewriter, type TranscriptSegment } from "@hongtai/core";

export interface MimoClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly asrModel: string;
  readonly textModel: string;
  readonly retryDelaysMs?: readonly number[];
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
        if (!text) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "MiMo ASR返回空文本", action: "retry" });
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
          issue: issueFromError(error, "obtain-transcript"),
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
      if (!text) throw new TaskError({ code: "AI_EMPTY_RESPONSE", message: "MiMo文本模型返回空整理稿", action: "retry" });
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
    if (url.protocol !== "https:") throw new TaskError({ code: "AI_NETWORK_FAILED", message: "MiMo Base URL必须使用HTTPS", action: "configure_ai" });
    const delays = this.#options.retryDelaysMs ?? [0, 1_000, 3_000];
    let lastError: TaskError | undefined;

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
        const responseText = (await response.text()).slice(0, 8_192);
        let payload: unknown;
        try {
          payload = responseText ? JSON.parse(responseText) : {};
        } catch (error) {
          if (response.ok) throw new TaskError({ code: "AI_SERVER_ERROR", message: "MiMo返回了无效JSON", retryable: true, action: "retry", cause: error });
          payload = {};
        }
        if (response.ok) return payload;

        const providerError = (payload as { error?: { code?: unknown; type?: unknown; message?: unknown } })?.error;
        const providerCode = typeof providerError?.code === "string" ? providerError.code.slice(0, 100) : undefined;
        const providerType = typeof providerError?.type === "string" ? providerError.type.slice(0, 100) : undefined;
        const providerMessage = typeof providerError?.message === "string" ? providerError.message.slice(0, 500) : "";
        const details = {
          httpStatus: response.status,
          ...(providerCode ? { providerCode } : {}),
          ...(providerType ? { providerType } : {}),
        };
        if (response.status === 401) throw new TaskError({ code: "AI_AUTH_INVALID", message: "MiMo API Key无效", action: "configure_ai", details });
        if (response.status === 403 || response.status === 404) throw new TaskError({ code: "AI_PERMISSION_DENIED", message: "MiMo账户没有对应模型权限", action: "configure_ai", details });
        if (response.status === 429) {
          const quota = /quota|balance|credit|insufficient|额度|余额/i.test(`${providerCode ?? ""} ${providerType ?? ""} ${providerMessage}`);
          if (quota) throw new TaskError({ code: "AI_QUOTA_EXHAUSTED", message: "MiMo账户额度或余额不足", action: "configure_ai", details });
          lastError = new TaskError({ code: "AI_RATE_LIMITED", message: "MiMo请求过于频繁，请稍后重试", retryable: true, action: "wait_and_retry", details });
          continue;
        }
        if (response.status >= 500) {
          lastError = new TaskError({ code: "AI_SERVER_ERROR", message: "MiMo服务暂时不可用", retryable: true, action: "wait_and_retry", details });
          continue;
        }
        throw new TaskError({ code: "AI_SERVER_ERROR", message: `MiMo请求被拒绝：HTTP ${response.status}`, action: "configure_ai", details });
      } catch (error) {
        if (error instanceof TaskError) {
          if (!error.retryable) throw error;
          lastError = error;
          continue;
        }
        const name = error instanceof Error ? error.name : "UnknownError";
        const timedOut = name === "AbortError" || name === "TimeoutError";
        lastError = new TaskError({
          code: timedOut ? "AI_TIMEOUT" : "AI_NETWORK_FAILED",
          message: timedOut ? "MiMo请求超时" : "无法连接MiMo服务",
          retryable: true,
          action: timedOut ? "retry" : "check_network",
          cause: error,
        });
      }
    }
    throw lastError ?? new TaskError({ code: "AI_NETWORK_FAILED", message: "MiMo请求失败", action: "retry" });
  }
}
