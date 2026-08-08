import { readFile } from "node:fs/promises";
import type { OpenAiCompatibleProvider } from "@hongtai/ai";
import { createNodeOpenAiCompatibleProvider, type NodeOpenAiCompatibleProviderConfig } from "@hongtai/ai/node";
import { issueFromError, summarizeTranscription, type MediaTranscriber, type TextRewriter, type TranscriptionResult, type TranscriptSegment } from "@hongtai/core";

const REWRITE_SYSTEM_PROMPT = `你是短视频文稿整理助手。请严格遵守：
1. 只根据原始语音转写整理，不新增任何事实、数字、功效、医学结论或观点；
2. 修复明显错别字和标点，删除无意义口癖，按语义合理分段；
3. 保留原有语气、专有名词、数字和结论；
4. 只输出整理后的正文，不解释处理过程。`;

export class OpenAiMediaClient implements MediaTranscriber, TextRewriter {
  readonly #provider: OpenAiCompatibleProvider;

  constructor(options: NodeOpenAiCompatibleProviderConfig) {
    this.#provider = createNodeOpenAiCompatibleProvider(options);
  }

  async transcribe(
    segmentPaths: readonly string[],
    segmentSeconds: number,
    onSegment?: (segment: TranscriptSegment, completed: number, total: number) => void | Promise<void>,
  ): Promise<TranscriptionResult> {
    const results: TranscriptSegment[] = [];
    for (let index = 0; index < segmentPaths.length; index += 1) {
      const segmentPath = segmentPaths[index];
      if (!segmentPath) continue;
      let result: TranscriptSegment;
      try {
        const audio = await readFile(segmentPath);
        const text = await this.#provider.transcribe({ data: audio, filename: `segment-${index}.wav`, mimeType: "audio/wav" });
        result = text
          ? { index, startSeconds: index * segmentSeconds, endSeconds: (index + 1) * segmentSeconds, text, status: "succeeded" }
          : { index, startSeconds: index * segmentSeconds, endSeconds: (index + 1) * segmentSeconds, text: "", status: "no_speech" };
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
    return summarizeTranscription(results);
  }

  async rewrite(transcript: string): Promise<string> {
    const chunks = this.#splitText(transcript, 12_000);
    const results: string[] = [];
    for (const chunk of chunks) {
      const result = await this.#provider.generate({
        model: "text",
        output: "text",
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          { role: "user", content: chunk },
        ],
      });
      results.push(result.content);
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
}
