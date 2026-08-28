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
 * - `tts_duration`: the synthesized narration was measured, so the shot length follows real
 *   audio even though the cue boundaries inside it stay proportional to the copy.
 * - `script_estimate`: nothing was measured; the shot duration is spread across its characters.
 */
export const SUBTITLE_TIMING_SOURCES = ["asr_word", "asr_segment", "tts_duration", "script_estimate"] as const;
export type SubtitleTimingSource = (typeof SUBTITLE_TIMING_SOURCES)[number];

/** How closely the cues track the real voice. Only `word` may drive a per-word reveal. */
export const SUBTITLE_TIMING_PRECISIONS = ["word", "cue", "estimated"] as const;
export type SubtitleTimingPrecision = (typeof SUBTITLE_TIMING_PRECISIONS)[number];

const PRECISION_BY_SOURCE: Readonly<Record<SubtitleTimingSource, SubtitleTimingPrecision>> = {
  asr_word: "word",
  asr_segment: "cue",
  tts_duration: "estimated",
  script_estimate: "estimated",
};

/** Cue ceiling for one shot. The plan schema and the Android parser both derive from this. */
export const MAX_CUES_PER_SHOT = 12;

/** Cue text ceiling. The plan schema derives from this. */
export const MAX_CUE_CHARACTERS = 40;

/** Emphasis words one cue may carry, and the longest each may be. */
export const MAX_EMPHASIS_WORDS_PER_CUE = 3;
export const MAX_EMPHASIS_WORD_CHARACTERS = 12;

/**
 * A cue shorter than this flashes past unread. Cue count follows the copy and the template's
 * line box, so a shot too short for its narration produces cues below this; the copy cannot be
 * compressed without dropping words. Planning does not refuse such a shot — dropping words would
 * be worse — so the export screen warns about it per shot and leaves the choice to the user.
 */
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
  return PRECISION_BY_SOURCE[source];
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

/** Shortest tail cue worth showing alone; below this the fragment reads as a glitch. */
export const MIN_TAIL_CHARACTERS = 6;

/**
 * Cutting greedily can leave two or three trailing characters as their own cue, which flashes
 * past as a fragment. Fold that tail into the previous cue when it still fits, otherwise move
 * the cut back until both halves are readable. Giving up leaves the greedy result rather than
 * dropping or rewriting the copy.
 */
function absorbShortTail(
  characters: readonly string[],
  cuts: readonly number[],
  typography: SubtitleTypography,
): readonly number[] {
  const last = cuts[cuts.length - 1];
  if (last === undefined || characters.length - last >= MIN_TAIL_CHARACTERS) return cuts;
  const previous = cuts.length >= 2 ? cuts[cuts.length - 2] ?? 0 : 0;

  const joined = sliceAt(characters, previous, characters.length);
  if (joined.length <= MAX_CUE_CHARACTERS && subtitleTextFits(joined, typography)) return cuts.slice(0, -1);

  for (let moved = last - 1; moved > previous; moved -= 1) {
    if (characters.length - moved < MIN_TAIL_CHARACTERS) continue;
    const head = sliceAt(characters, previous, moved);
    const tail = sliceAt(characters, moved, characters.length);
    if (!head || !tail) continue;
    if (subtitleTextFits(head, typography) && subtitleTextFits(tail, typography)) return [...cuts.slice(0, -1), moved];
  }
  return cuts;
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
  return absorbShortTail(characters, cuts, typography);
}

export interface ShotCueTimelineInput {
  /** Spoken copy for one shot; cue text is taken from it verbatim. */
  readonly text: string;
  readonly shotDurationMs: number;
  readonly typography: SubtitleTypography;
  /** Words the template may emphasise; each one attaches to the cue that contains it. */
  readonly emphasisWords?: readonly string[];
  /**
   * 词级实测时间戳（相对本句音频起点，来自 `TtsTimedTrack.words`）。提供且非空时走
   * `asr_word` 路径：cue 边界直接取词级时间，`text` 不再参与定界；缺失或为空时保持
   * 既有比例路径（`script_estimate` 与 `tts_duration` 共用），不伪造词级时间。
   */
  readonly words?: readonly SubtitleCueWordTiming[] | null;
}

/**
 * Keeps a cue's emphasis list inside what the plan schema and the renderer accept. Callers may
 * pass whatever the planner produced, and over-long or surplus words are dropped rather than
 * failing the whole plan over decoration.
 */
function emphasisFor(text: string, candidates: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (const word of candidates) {
    if (kept.length >= MAX_EMPHASIS_WORDS_PER_CUE) break;
    if (!word || [...word].length > MAX_EMPHASIS_WORD_CHARACTERS) continue;
    if (text.includes(word) && !kept.includes(word)) kept.push(word);
  }
  return kept;
}

/**
 * Groups measured words into cues the template's line box can hold. Cut points only fall on word
 * boundaries: a timestamp that splits a spoken word cannot be honoured honestly, so a word is never
 * divided across cues even when it straddles the character budget.
 */
function wordCueGroups(
  words: readonly SubtitleCueWordTiming[],
  limit: number,
  typography: SubtitleTypography,
): readonly (readonly SubtitleCueWordTiming[])[] {
  const groups: SubtitleCueWordTiming[][] = [];
  let current: SubtitleCueWordTiming[] = [];
  let currentText = "";
  for (const word of words) {
    const nextText = currentText + word.text;
    if (current.length > 0 && ([...nextText].length > limit || !subtitleTextFits(nextText, typography))) {
      groups.push(current);
      current = [word];
      currentText = word.text;
    } else {
      current = [...current, word];
      currentText = nextText;
    }
  }
  if (current.length > 0) groups.push(current);

  // A one- or two-word tail flashes past as a fragment; fold it into the previous cue when the
  // joined text still fits, mirroring `absorbShortTail` for the proportional path.
  if (groups.length >= 2) {
    const last = groups[groups.length - 1] ?? [];
    const previous = groups[groups.length - 2] ?? [];
    const lastText = last.map((word) => word.text).join("");
    if ([...lastText].length < MIN_TAIL_CHARACTERS) {
      const joined = [...previous, ...last].map((word) => word.text).join("");
      if ([...joined].length <= MAX_CUE_CHARACTERS && subtitleTextFits(joined, typography)) {
        groups.splice(groups.length - 2, 2, [...previous, ...last]);
      }
    }
  }
  return groups;
}

/**
 * The `asr_word` tier: cue boundaries are the measured word boundaries themselves. The first cue
 * starts when the first word starts and the last ends when the last word ends, so silences before,
 * between and after speech show through instead of being papered over with proportional guesses.
 *
 * Word times are rounded onto the integer millisecond clock the renderer keeps; the sequential
 * clamp only guards pathological fractional input, because real TTS/ASR timestamps arrive in whole
 * milliseconds already.
 */
function cuesFromWordTimings(
  words: readonly SubtitleCueWordTiming[],
  durationMs: number,
  typography: SubtitleTypography,
  emphasis: readonly string[],
): readonly SubtitleCueTiming[] {
  const cues: SubtitleCueTiming[] = [];
  for (const group of wordCueGroups(words, cueCharacterBudget(typography), typography)) {
    const text = group.map((word) => word.text).join("");
    if (!text.trim()) continue;
    const clocked: SubtitleCueWordTiming[] = [];
    let previousEndMs = 0;
    for (const word of group) {
      const startMs = Math.max(previousEndMs, Math.min(Math.round(word.startMs), Math.max(durationMs - 1, 0)));
      const endMs = Math.max(startMs + 1, Math.min(Math.round(word.endMs), durationMs));
      clocked.push({ text: word.text, startMs, endMs });
      previousEndMs = endMs;
    }
    const first = clocked[0];
    const last = clocked[clocked.length - 1];
    if (!first || !last) continue;
    cues.push({
      startMs: first.startMs,
      endMs: Math.max(first.startMs + 1, last.endMs),
      text,
      emphasisWords: emphasisFor(text, emphasis),
      words: clocked,
    });
  }
  return cues;
}

/**
 * Splits one shot's narration into readable cues and spreads the shot duration across them
 * by character count. This is the `script_estimate` and `tts_duration` tier: cue order and
 * length are real, but the boundaries are proportional rather than measured against speech.
 *
 * Cue count follows the copy and the template's line box, never the shot duration. A shot too
 * short for its narration therefore yields cues below `MIN_CUE_DURATION_MS`, because the only
 * ways to slow them down would be to drop words or to overflow the caption band.
 */
export function buildShotCueTimeline(input: ShotCueTimelineInput): readonly SubtitleCueTiming[] {
  const durationMs = Math.round(input.shotDurationMs);
  if (durationMs <= 0) return [];

  // 词级实测路径（asr_word）：定界失败（例如词文本全为空白）时退回比例路径，而不是产出空字幕。
  if (input.words && input.words.length > 0) {
    const measured = cuesFromWordTimings(input.words, durationMs, input.typography, input.emphasisWords ?? []);
    if (measured.length > 0) return measured;
  }

  const characters = [...input.text.replace(/\s+/gu, " ").trim()];
  if (characters.length === 0) return [];

  const cuts = cutPositions(characters, cueCharacterBudget(input.typography), input.typography);
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
      emphasisWords: emphasisFor(text, emphasis),
      words: null,
    });
    startMs = endMs;
  }

  return cues;
}
