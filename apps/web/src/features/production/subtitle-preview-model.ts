import { SUBTITLE_REFERENCE_WIDTH_PX, type SubtitleColor, type SubtitleStroke } from "@hongtai/core";

export interface SubtitleSegment {
  readonly text: string;
  readonly emphasized: boolean;
}

/** Scale factor that maps template reference pixels onto the measured preview frame. */
export function subtitleScale(frameWidth: number): number {
  return frameWidth > 0 ? frameWidth / SUBTITLE_REFERENCE_WIDTH_PX : 0;
}

export function subtitleCssColor(color: SubtitleColor): string {
  const channel = (offset: number) => Number.parseInt(color.hex.slice(offset, offset + 2), 16);
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${color.opacity})`;
}

/**
 * Approximates the burned-in stroke with a ring of text shadows. Chromium 89 in the Android
 * WebView does not honour `paint-order` on HTML text, so a shadow ring is the reliable way to
 * preview the same outline width the renderer draws.
 */
export function subtitleStrokeShadow(stroke: SubtitleStroke | null, scale: number): string | undefined {
  if (!stroke || scale <= 0) return undefined;
  const radius = Math.max(0.5, (stroke.widthPx / 2) * scale);
  const color = subtitleCssColor(stroke.color);
  const diagonal = radius * 0.72;
  const offsets: readonly (readonly [number, number])[] = [
    [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [diagonal, diagonal], [diagonal, -diagonal], [-diagonal, diagonal], [-diagonal, -diagonal],
  ];
  return offsets.map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px 0 ${color}`).join(", ");
}

/** Splits one display line so emphasised words can carry the template's emphasis style. */
export function splitEmphasisSegments(line: string, emphasisWords: readonly string[] = []): readonly SubtitleSegment[] {
  const words = emphasisWords.map((word) => word.trim()).filter((word) => word.length > 0);
  if (words.length === 0) return [{ text: line, emphasized: false }];

  const segments: SubtitleSegment[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    let matched = "";
    let matchedAt = -1;
    for (const word of words) {
      const at = line.indexOf(word, cursor);
      if (at < 0) continue;
      if (matchedAt < 0 || at < matchedAt || (at === matchedAt && word.length > matched.length)) {
        matched = word;
        matchedAt = at;
      }
    }
    if (matchedAt < 0) {
      segments.push({ text: line.slice(cursor), emphasized: false });
      break;
    }
    if (matchedAt > cursor) segments.push({ text: line.slice(cursor, matchedAt), emphasized: false });
    segments.push({ text: matched, emphasized: true });
    cursor = matchedAt + matched.length;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

/**
 * Maps overall spoken progress onto one display line so the karaoke reveal sweeps the lines in
 * reading order instead of restarting on every line.
 */
export function subtitleLineProgress(lines: readonly string[], index: number, progress: number): number {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (total === 0) return 0;
  const start = lines.slice(0, index).reduce((sum, line) => sum + line.length, 0);
  const length = lines[index]?.length ?? 0;
  if (length === 0) return 0;
  const spoken = Math.min(Math.max(progress, 0), 1) * total;
  return Math.min(Math.max((spoken - start) / length, 0), 1);
}
