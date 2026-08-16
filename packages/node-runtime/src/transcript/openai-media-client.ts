import { readFile } from "node:fs/promises";
import { splitTranscriptRewriteChunks, TRANSCRIPT_REWRITE_SYSTEM_PROMPT, type OpenAiCompatibleProvider } from "@hongtai/ai";
import { createNodeOpenAiCompatibleProvider, type NodeOpenAiCompatibleProviderConfig } from "@hongtai/ai/node";
import { issueFromError, summarizeTranscription, type MediaTranscriber, type TextRewriter, type TranscriptionResult, type TranscriptSegment } from "@hongtai/core";

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
    const results: string[] = [];
    for (const chunk of splitTranscriptRewriteChunks(transcript)) {
      const result = await this.#provider.generate({
        model: "text",
        output: "text",
        messages: [
          { role: "system", content: TRANSCRIPT_REWRITE_SYSTEM_PROMPT },
          { role: "user", content: chunk },
        ],
      });
      results.push(result.content);
    }
    return results.join("\n\n");
  }
}
