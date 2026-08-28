import {
  buildShotCueTimeline,
  checkMeasuredProductionDurations,
  resolveTemplateForPrecision,
  subtitleTimingPrecision,
  timedTrackTimingSource,
  type AvatarSourceWindow,
  type SubtitleTimingSource,
  type TaskError,
  type TtsTimedTrack,
} from "@hongtai/core";

import {
  productionPlanResultV3Schema,
  productionPlanResultV4Schema,
  type ProductionPlanGrounding,
  type ProductionPlanResultV2,
  type ProductionPlanResultV3,
  type ProductionPlanResultV4,
} from "../../schemas/production-plan";
import { deriveDecorationTimeline, type DecorationIntent } from "./production-decoration-timeline";

export interface SubtitleTimelineInput {
  /** A plan carrying every v2 field; the subtitle timeline is derived from its shots. */
  readonly plan: ProductionPlanResultV2;
  /** Evidence behind the cue boundaries, which decides the precision the plan may claim. */
  readonly source: SubtitleTimingSource;
  /** Template the user picked; degraded automatically when it needs word-level timing. */
  readonly requestedTemplateId?: string;
  /**
   * How this run matched narration to material. Omitted by an edit, which reuses whatever the plan
   * already recorded: rewriting a caption does not make the planner have seen the pictures, and it
   * does not un-see them either.
   */
  readonly grounding?: ProductionPlanGrounding;
  /**
   * Sticker/floating-text choices without timestamps. Windows are taken from the cues built above
   * so an edit that rewrites narration keeps the same stickers instead of wiping them.
   */
  readonly decorations?: readonly DecorationIntent[];
  /** How this caller reports a plan it cannot make executable, since recovery differs per mode. */
  readonly invalid: (cause: unknown) => TaskError;
}

/**
 * Turns a v2-shaped plan into a validated v3 plan by deriving each shot's cue timeline.
 *
 * Cue milliseconds are computed here rather than asked of a language model, which produces
 * plausible numbers that do not add up. Decoration windows follow the same rule: the model may
 * pick a shot, a catalogue id and an anchor, and this function maps those onto the cues it just
 * built. The result is parsed against its own schema before it is returned: a plan that fails the
 * schema would still persist, and the project could no longer be opened afterwards.
 */
export function withSubtitleTimeline(input: SubtitleTimelineInput): ProductionPlanResultV3 {
  const precision = subtitleTimingPrecision(input.source);
  const resolved = resolveTemplateForPrecision({ requestedId: input.requestedTemplateId ?? "", precision });
  const shots = input.plan.shots.map((shot) => ({
    ...shot,
    cues: buildShotCueTimeline({
      text: shot.narration,
      shotDurationMs: Math.round(shot.durationSeconds * 1_000),
      typography: resolved.template.typography,
    }).map((cue) => ({ ...cue, emphasisWords: [...cue.emphasisWords] })),
  }));
  const derived = {
    ...input.plan,
    schemaVersion: "production-plan.v3",
    subtitle: {
      templateId: resolved.template.id,
      timing: { precision, source: input.source },
      degradedFromTemplateId: resolved.degradedFrom ?? null,
    },
    shots,
    decorations: deriveDecorationTimeline(input.decorations ?? [], shots),
    ...(input.grounding === undefined ? {} : { grounding: input.grounding }),
  };

  const parsed = productionPlanResultV3Schema.safeParse(derived);
  if (!parsed.success) throw input.invalid(parsed.error);
  return parsed.data;
}

/** v4 组装的镜头草稿：一句分镜 + 绑定，时长由对应实测音轨决定，此处不填。 */
export interface MeasuredShotDraft {
  /** 对应 `ScriptSentence.id`，镜头与口播句、配音资产都以它对回；同一计划内不得重复。 */
  readonly sentenceId: string;
  readonly assetId: string;
  readonly narration: string;
  readonly caption: string;
  readonly fit: "cover" | "contain";
  /**
   * 数字人镜头的源视频窗口（可选）：调用方（avatar 模式组装）用 `planAvatarSourceWindows`
   * 按实测时长烘焙好原样透传；此处既不裁剪也不取整——非整毫秒窗口会被 v4 schema 如实拒绝，
   * 而不是悄悄偏移音画同步。窗口时长之和必须等于该镜头实测时长。
   */
  readonly sourceWindows?: readonly AvatarSourceWindow[];
  /**
   * 本句字幕的强调词建议（来自分镜脚本的 AI 自动配置）。透传给 cue 构建，按既有
   * `emphasisFor` 规则过滤（不在文案中的词丢弃），不影响 cue 边界。
   */
  readonly emphasisWords?: readonly string[];
}

export interface MeasuredSubtitleTimelineInput
  extends Pick<ProductionPlanResultV4, "source" | "title" | "audio" | "textOverlay"> {
  readonly shots: readonly MeasuredShotDraft[];
  /** 与 shots 按 sentenceId 一一对应的实测音轨；缺失、多出或重复都拒绝，不猜时长。 */
  readonly tracks: readonly TtsTimedTrack[];
  /** Template the user picked; degraded automatically when the evidence cannot carry it. */
  readonly requestedTemplateId?: string;
  /**
   * How this run matched narration to material. Omitted by an edit, which reuses whatever the plan
   * already recorded: rewriting a caption does not make the planner have seen the pictures, and it
   * does not un-see them either.
   */
  readonly grounding?: ProductionPlanGrounding;
  /**
   * Sticker/floating-text choices without timestamps. Windows are taken from the cues built above
   * so an edit that rewrites narration keeps the same stickers instead of wiping them.
   */
  readonly decorations?: readonly DecorationIntent[];
  /** How this caller reports a plan it cannot make executable, since recovery differs per mode. */
  readonly invalid: (cause: unknown) => TaskError;
}

/**
 * 把分镜草稿 + 实测音轨组装成 v4 计划：每镜 `durationMs` 取对应句 `TtsTimedTrack.durationMs`
 * （先取整到渲染器的毫秒时钟），毫秒数全部本地推导——模型从不经手时间。每镜 cue 边界优先
 * 用本句词级时间戳定界；缺词级的句子按实测句长比例铺排。计划级 `timing.source` 取全部音轨
 * 的最弱证据：任何一句缺词级时间戳，整份计划就如实声明 `tts_duration` 并按既有规则降级字幕
 * 模板，不宣称高于实际证据的精度。硬违规（非法时长、镜头数越界）的实测时长在这里就拒绝；
 * 软违规（单镜过短/超 20 秒、总时长出 15–60 秒）不阻塞组装，由 `validateMeasuredProductionPlan`
 * 结构化返回给界面提示。
 */
export function withMeasuredSubtitleTimeline(input: MeasuredSubtitleTimelineInput): ProductionPlanResultV4 {
  const shotsBySentenceId = new Map<string, MeasuredShotDraft>();
  for (const shot of input.shots) {
    if (shotsBySentenceId.has(shot.sentenceId)) {
      throw input.invalid(`句子 ${shot.sentenceId} 在分镜里出现了不止一次`);
    }
    shotsBySentenceId.set(shot.sentenceId, shot);
  }

  const tracksBySentenceId = new Map<string, TtsTimedTrack>();
  for (const track of input.tracks) {
    if (tracksBySentenceId.has(track.sentenceId)) {
      throw input.invalid(`句子 ${track.sentenceId} 有不止一条实测音轨`);
    }
    tracksBySentenceId.set(track.sentenceId, track);
  }

  const matched: { shot: MeasuredShotDraft; track: TtsTimedTrack }[] = [];
  for (const [index, shot] of input.shots.entries()) {
    const track = tracksBySentenceId.get(shot.sentenceId);
    if (!track) throw input.invalid(`第 ${index + 1} 句还没有实测音轨`);
    matched.push({ shot, track });
  }
  const unmatched = input.tracks.filter((track) => !shotsBySentenceId.has(track.sentenceId));
  if (unmatched.length > 0) {
    throw input.invalid(`实测音轨 ${unmatched[0]?.sentenceId} 没有对应的分镜句`);
  }

  // 渲染器按整毫秒工作，实测时长先取整再进入计划，校验与持久化用同一个数。
  const durationCheck = checkMeasuredProductionDurations({
    shotDurationMs: matched.map(({ track }) => Math.round(track.durationMs)),
  });
  if (!durationCheck.ok) throw input.invalid(durationCheck.hardViolations);

  // 计划级时间来源取最弱证据：任何一句缺词级时间戳，整份计划就只能如实声明 tts_duration。
  const source: SubtitleTimingSource = matched.every(({ track }) => timedTrackTimingSource(track) === "asr_word")
    ? "asr_word"
    : "tts_duration";
  const precision = subtitleTimingPrecision(source);
  const resolved = resolveTemplateForPrecision({ requestedId: input.requestedTemplateId ?? "", precision });

  // 数字人窗口守恒：窗口时长之和必须精确等于该镜头取整后的实测时长，否则音画必然失步。
  // 规划器在整数输入下天然保证这一点；这里只拦截调用方喂错数据的契约破坏，让失败发生在
  // 组装期而不是端侧导出期。
  for (const { shot, track } of matched) {
    if (!shot.sourceWindows) continue;
    const coveredMs = shot.sourceWindows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0);
    if (coveredMs !== Math.round(track.durationMs)) {
      throw input.invalid(`句子 ${shot.sentenceId} 的数字人窗口时长之和与实测时长不一致`);
    }
  }

  const shots = matched.map(({ shot, track }, index) => {
    const cues = buildShotCueTimeline({
      text: shot.narration,
      shotDurationMs: Math.round(track.durationMs),
      typography: resolved.template.typography,
      words: track.words ?? null,
      ...(shot.emphasisWords && shot.emphasisWords.length > 0 ? { emphasisWords: shot.emphasisWords } : {}),
    }).map((cue) => ({ ...cue, emphasisWords: [...cue.emphasisWords] }));

    // 字幕完整性：非空口播必须产出字幕；比例路径（cue 不带词级时间）的拼接去空白后
    // 必须逐字等于整句口播——字幕允许切分换行，不允许丢字或改写。词级路径的 cue 文本
    // 来自实测词文本（可能含 TTS 归一化差异），由词级校验保证自洽，不与口播稿强相等。
    const spoken = shot.narration.replace(/\s+/gu, "");
    if (spoken.length > 0 && cues.length === 0) {
      throw input.invalid(`句子 ${shot.sentenceId} 的口播没有产出任何字幕`);
    }
    if (spoken.length > 0 && cues.length > 0 && cues.every((cue) => cue.words === null)) {
      const covered = cues.map((cue) => cue.text).join("").replace(/\s+/gu, "");
      if (covered !== spoken) {
        throw input.invalid(`句子 ${shot.sentenceId} 的字幕没有逐字覆盖整句口播`);
      }
    }

    return {
      order: index + 1,
      assetId: shot.assetId,
      durationMs: Math.round(track.durationMs),
      sentenceId: shot.sentenceId,
      narration: shot.narration,
      caption: shot.caption,
      fit: shot.fit,
      ...(shot.sourceWindows ? { sourceWindows: [...shot.sourceWindows] } : {}),
      cues,
    };
  });

  const derived = {
    schemaVersion: "production-plan.v4",
    source: input.source,
    title: input.title,
    settings: { width: 720, height: 1280, fps: 30 },
    audio: input.audio,
    textOverlay: input.textOverlay,
    subtitle: {
      templateId: resolved.template.id,
      timing: { precision, source },
      degradedFromTemplateId: resolved.degradedFrom ?? null,
    },
    shots,
    decorations: deriveDecorationTimeline(input.decorations ?? [], shots),
    ...(input.grounding === undefined ? {} : { grounding: input.grounding }),
  };

  const parsed = productionPlanResultV4Schema.safeParse(derived);
  if (!parsed.success) throw input.invalid(parsed.error);
  return parsed.data;
}
