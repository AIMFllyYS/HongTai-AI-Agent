import type { TranscriptionResult, TranscriptSegment } from "./models";

export function summarizeTranscription(segments: readonly TranscriptSegment[]): TranscriptionResult {
  const text = segments
    .filter((segment) => segment.status === "succeeded")
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");

  if (text) return { status: "transcribed", text, segments };
  if (segments.length > 0 && segments.every((segment) => segment.status === "no_speech")) {
    return { status: "no_speech", text: "", segments };
  }
  return { status: "failed", text: "", segments };
}
