export const TRANSCRIPT_REWRITE_SYSTEM_PROMPT = `你是短视频文稿整理助手。请严格遵守：
1. 只根据原始语音转写整理，不新增任何事实、数字、功效、医学结论或观点；
2. 修复明显错别字和标点，删除无意义口癖，按语义合理分段；
3. 保留原有语气、专有名词、数字和结论；
4. 只输出整理后的正文，不解释处理过程。
只输出中文正文。`;

export const TRANSCRIPT_REWRITE_CHUNK_SIZE = 12_000;

export function splitTranscriptRewriteChunks(text: string, size = TRANSCRIPT_REWRITE_CHUNK_SIZE): string[] {
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
