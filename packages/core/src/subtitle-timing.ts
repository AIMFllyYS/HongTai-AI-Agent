/**
 * Cue timing rules shared by every planner.
 *
 * Cue boundaries are only as trustworthy as the audio evidence behind them, so a timeline
 * always travels with the tier it came from. Templates that need per-word timing degrade
 * instead of being fed invented timestamps.
 */
import { subtitleTextFits, type ResolvedSubtitleTemplate, type SubtitleTypography } from "./subtitle-template";
import { resolveSubtitleTemplate } from "./subtitle-template-presets";

export const SUBTITLE_TIMING_CONTRACT_VERSION = "subtitle-timing.v1";

/**
 * Evidence behind the cue boundaries, strongest first.
 *
 * - `asr_word`: transcription returned per-word timestamps for this audio.
 * - `asr_segment`: transcription returned phrase timestamps but no words.
 * - `tts_duration`: the synthesized narration was measured, so cues follow real audio length.
 * - `script_estimate`: nothing was measured; the shot duration is spread across its characters.
 */
export const SUBTITLE_TIMING_SOURCES = ["asr_word", "asr_segment", "tts_duration", "script_estimate"] as const;
export type SubtitleTimingSource = (typeof SUBTITLE_TIMING_SOURCES)[number];

/** How closely the cues track the real voice. Only `word` may drive a per-word reveal. */
export const SUBTITLE_TIMING_PRECISIONS = ["word", "cue", "estimated"] as const;
export type SubtitleTimingPrecision = (typeof SUBTITLE_TIMING_PRECISIONS)[number];

export const SUBTITLE_TIMING_PRECISION_BY_SOURCE: Readonly<Record<SubtitleTimingSource, SubtitleTimingPrecision>> = {
  asr_word: "word",
  asr_segment: "cue",
  tts_duration: "estimated",
  script_estimate: "estimated",
};

/** Cue ceiling for one shot, matching the plan schema. */
export const MAX_CUES_PER_SHOT = 12;

/** Cue text ceiling from the plan schema. */
export const MAX_CUE_CHARACTERS = 40;

/** A cue shorter than this flashes past unread, so neighbours are merged when the budget allows. */
export const MIN_CUE_DURATION_MS = 600;

export interface SubtitleCueWordTiming {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface SubtitleCueTiming {
  /** Milliseconds relative to the start of the owning shot. */
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly emphasisWords: readonly string[];
  /** Per-word timings when the tier produced them; null keeps the cue line-level. */
  readonly words: readonly SubtitleCueWordTiming[] | null;
}

export function subtitleTimingPrecision(source: SubtitleTimingSource): SubtitleTimingPrecision {
  return SUBTITLE_TIMING_PRECISION_BY_SOURCE[source];
}

/**
 * Picks the template that can be rendered honestly at this precision. Anything below
 * `word` falls back to the template's declared alternative rather than faking per-word
 * alignment, and the caller persists the result so the renderer never has to re-decide.
 */
export function resolveTemplateForPrecision(input: {
  readonly requestedId: string;
  readonly precision: SubtitleTimingPrecision;
}): ResolvedSubtitleTemplate {
  return resolveSubtitleTemplate({ id: input.requestedId, hasWordTiming: input.precision === "word" });
}

/**
 * Upper bound on cue length for this template. Line breaking prefers phrase boundaries, so a
 * cue this long can still spill onto an extra line; `subtitleTextFits` is the real gate.
 */
export function cueCharacterBudget(typography: SubtitleTypography): number {
  const budget = Math.floor(typography.maxLines) * Math.floor(typography.maxCharsPerLine);
  return Math.max(1, Math.min(MAX_CUE_CHARACTERS, budget));
}

const SENTENCE_BOUNDARIES = new Set(["。", "！", "？", "…", "!", "?"]);
const CLAUSE_BOUNDARIES = new Set(["，", "；", "、", "：", ",", ";", ":", " "]);

/**
 * Prefers a sentence boundary, then a clause boundary, and only then a hard cut. The search
 * stops at the halfway mark so one early comma cannot leave a two-character cue behind.
 */
function preferredCut(window: readonly string[]): number {
  const earliest = Math.ceil(window.length / 2);
  for (const boundaries of [SENTENCE_BOUNDARIES, CLAUSE_BOUNDARIES]) {
    for (let position = window.length - 1; position >= earliest; position -= 1) {
      const candidate = window[position];
      if (candidate !== undefined && boundaries.has(candidate)) return position + 1;
    }
  }
  return window.length;
}

function sliceAt(characters: readonly string[], from: number, to: number): string {
  return characters.slice(from, to).join("").trim();
}

/** Shrinks a candidate cut until the cue really fits the template's line box. */
function fittingTake(characters: readonly string[], index: number, limit: number, typography: SubtitleTypography): number {
  const window = characters.slice(index, index + limit);
  let take = preferredCut(window);
  while (take > 1 && !subtitleTextFits(sliceAt(characters, index, index + take), typography)) take -= 1;
  return take;
}

function cutPositions(characters: readonly string[], limit: number, typography: SubtitleTypography): readonly number[] {
  const cuts: number[] = [];
  let index = 0;
  while (index < characters.length) {
    const take = fittingTake(characters, index, Math.min(limit, characters.length - index), typography);
    if (index + take >= characters.length) break;
    index += take;
    cuts.push(index);
  }
  return cuts;
}

/**
 * Drops the cut whose two neighbours join into the shortest still-renderable cue. Returns null
 * when every merge would overflow the template, which keeps a fast cue rather than an
 * unreadable one.
 */
function cheapestRemovableCut(
  characters: readonly string[],
  cuts: readonly number[],
  typography: SubtitleTypography,
): number | null {
  const boundaries = [0, ...cuts, characters.length];
  let best: number | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (let index = 0; index < cuts.length; index += 1) {
    const merged = sliceAt(characters, boundaries[index] ?? 0, boundaries[index + 2] ?? characters.length);
    if (merged.length > MAX_CUE_CHARACTERS || merged.length >= bestLength) continue;
    if (!subtitleTextFits(merged, typography)) continue;
    best = index;
    bestLength = merged.length;
  }
  return best;
}

function reduceCuts(
  characters: readonly string[],
  cuts: readonly number[],
  ceiling: number,
  typography: SubtitleTypography,
): readonly number[] {
  const current = [...cuts];
  while (current.length + 1 > ceiling) {
    const removable = cheapestRemovableCut(characters, current, typography);
    if (removable === null) break;
    current.splice(removable, 1);
  }
  return current;
}

export interface ShotCueTimelineInput {
  /** Spoken copy for one shot; cue text is taken from it verbatim. */
  readonly text: string;
  readonly shotDurationMs: number;
  readonly typography: SubtitleTypography;
  /** Words the template may emphasise; each one attaches to the cue that contains it. */
  readonly emphasisWords?: readonly string[];
}

/**
 * Splits one shot's narration into readable cues and spreads the shot duration across them
 * by character count. This is the `script_estimate` and `tts_duration` tier: cue order and
 * length are real, but the boundaries are proportional rather than measured against speech.
 */
export function buildShotCueTimeline(input: ShotCueTimelineInput): readonly SubtitleCueTiming[] {
  const durationMs = Math.round(input.shotDurationMs);
  if (durationMs <= 0) return [];
  const characters = [...input.text.replace(/\s+/gu, " ").trim()];
  if (characters.length === 0) return [];

  const limit = cueCharacterBudget(input.typography);
  const affordable = Math.max(1, Math.floor(durationMs / MIN_CUE_DURATION_MS));
  const ceiling = Math.min(MAX_CUES_PER_SHOT, affordable);
  const cuts = reduceCuts(characters, cutPositions(characters, limit, input.typography), ceiling, input.typography);
  const boundaries = [0, ...cuts, characters.length];

  const texts: string[] = [];
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const text = sliceAt(characters, boundaries[index] ?? 0, boundaries[index + 1] ?? characters.length);
    if (text) texts.push(text);
  }
  if (texts.length === 0) return [];

  const weights = texts.map((text) => [...text].length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const emphasis = input.emphasisWords ?? [];
  const cues: SubtitleCueTiming[] = [];
  let startMs = 0;
  let consumed = 0;

  for (const [index, text] of texts.entries()) {
    consumed += weights[index] ?? 0;
    const remaining = texts.length - index - 1;
    const proportional = remaining === 0 ? durationMs : Math.round((consumed / totalWeight) * durationMs);
    // Every later cue keeps at least one millisecond, so rounding can never invert the order.
    const endMs = Math.max(startMs + 1, Math.min(durationMs - remaining, proportional));
    cues.push({
      startMs,
      endMs,
      text,
      emphasisWords: emphasis.filter((word) => text.includes(word)),
      words: null,
    });
    startMs = endMs;
  }

  return cues;
}
