import {
  createRuntimeId,
  estimateScriptSentenceMs,
  parseScriptStoryboard,
  TaskError,
  type ScriptStoryboard,
} from "@hongtai/core";

import type { AiStreamEvent } from "../../contracts/provider";
import type { ScriptGenerationAsset, ScriptGenerationFlowDependencies, ScriptGenerationInput } from "../../contracts/script-storyboard-generation";
import { sharesVerbatimRun } from "../../originality";
import { scriptStoryboardPrompt, scriptStoryboardRepairPrompt } from "../../prompts/script-storyboard";
import { scriptStoryboardDraftJsonSchema, scriptStoryboardDraftSchema, type ScriptStoryboardDraft } from "../../schemas/script-storyboard";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";

function invalidScript(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

function invalidInput(message: string): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "edit_input" });
}

/**
 * Avatar mode renders ONE pre-processed presenter video behind our own TTS narration: the script
 * is not bounded by that video's length (the segment planner cuts and loops it later), but the
 * video itself must already be probed so compose-time window planning has a source duration.
 */
function avatarVideoAsset(input: ScriptGenerationInput): ScriptGenerationAsset | undefined {
  return (input.assets ?? []).find((asset) => asset.role === "avatar" && asset.kind === "video");
}

function validateInput(input: ScriptGenerationInput): void {
  if (!input.brief.trim()) throw invalidInput("制作需求不能为空");
  if (input.mode === "avatar") {
    const avatars = (input.assets ?? []).filter((asset) => asset.role === "avatar" && asset.kind === "video");
    if (avatars.length !== 1) throw invalidInput("数字人模式需要且只能使用一个数字人视频");
    if (avatarVideoAsset(input)?.durationSeconds === undefined) {
      throw invalidInput("数字人视频缺少时长信息，无法规划画面裁剪");
    }
  }
}

/**
 * Reads which assets the sentences actually bound to. Derived from the run rather than asked of
 * the model: a storyboard that invented an assetId would ground narration in a picture the project
 * does not own, and a montage sentence bound to an audio asset would render without a picture.
 */
function validateGrounding(draft: ScriptStoryboardDraft, input: ScriptGenerationInput): void {
  const assets = input.assets ?? [];
  const known = new Map(assets.map((asset) => [asset.id, asset]));
  const avatar = input.mode === "avatar" ? avatarVideoAsset(input) : undefined;
  for (const [index, sentence] of draft.sentences.entries()) {
    if (sentence.assetId === undefined) {
      if (avatar) throw invalidScript(`第 ${index + 1} 句必须绑定数字人视频「${avatar.id}」`);
      continue;
    }
    const asset = known.get(sentence.assetId);
    if (!asset) throw invalidScript(`第 ${index + 1} 句引用了不存在的素材「${sentence.assetId}」`);
    if (asset.kind === "audio") throw invalidScript(`第 ${index + 1} 句不能绑定音频素材`);
    if (avatar && sentence.assetId !== avatar.id) {
      throw invalidScript(`第 ${index + 1} 句必须绑定数字人视频「${avatar.id}」，不能引用其他素材`);
    }
  }
}

/**
 * Turns the model draft into the versioned storyboard contract. `id` and `estimatedMs` are local:
 * ids come from the runtime id generator so a regenerated sentence can never silently reuse a
 * stale narration asset keyed by the old sentence, and the estimate is the honest character math —
 * the model is never asked for milliseconds.
 */
function assembleStoryboard(draft: ScriptStoryboardDraft): ScriptStoryboard {
  const parsed = parseScriptStoryboard({
    schemaVersion: "script-storyboard.v1",
    sentences: draft.sentences.map((sentence) => ({
      id: createRuntimeId(),
      text: sentence.text,
      ...(sentence.assetId === undefined ? {} : { assetId: sentence.assetId }),
      ...(sentence.stickerId === undefined ? {} : { stickerId: sentence.stickerId }),
      estimatedMs: estimateScriptSentenceMs(sentence.text),
    })),
    ...(draft.purpose === undefined ? {} : { purpose: draft.purpose }),
  });
  if (!parsed.ok) throw invalidScript(parsed.message);
  return parsed.value;
}

/**
 * 原创性校验的生成期执行点：montage 且带参考原文时，口播全文与原文出现连续重复即判
 * 无效，由 run() 的修复轮自动重写。放在这里而不是合成期，用户不用等到配完音才发现。
 */
function assertOriginalStoryboard(storyboard: ScriptStoryboard, input: ScriptGenerationInput): void {
  if (input.mode !== "montage" || !input.originalSourceText) return;
  const narration = storyboard.sentences.map((sentence) => sentence.text).join("");
  if (sharesVerbatimRun(narration, input.originalSourceText)) {
    throw invalidScript("分镜口播与参考原文存在连续重复，请重新组织原创表达");
  }
}

/**
 * 文稿先行的第一步：一句话需求（可选参考拆解与素材 insight）→ 逐句分镜脚本。
 *
 * 与 ProductionPlanningFlow 相同的调用结构：一次 structured-output 调用，解析失败或绑定
 * 校验失败走一次修复轮，修复仍失败抛 AI_FORMAT_REPAIR_FAILED。流式进度事件透传给
 * provider，并附带 generating/repairing 阶段标注，界面据此呈现逐句生成的实时过程。
 */
export class ScriptGenerationFlow {
  readonly #dependencies: ScriptGenerationFlowDependencies;

  constructor(dependencies: ScriptGenerationFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: ScriptGenerationInput): Promise<ScriptStoryboard> {
    validateInput(input);
    const onEvent = this.#dependencies.onEvent;
    const request = async (prompt: string, phase: "generating" | "repairing") => this.#dependencies.provider.generate({
      model: "text",
      output: "json",
      jsonSchema: { name: "script_storyboard_v1", schema: scriptStoryboardDraftJsonSchema, strict: true },
      messages: [{ role: "system", content: prompt }],
      // 阶段标注随流式事件透传：初稿 generating、修复轮 repairing。
      ...(onEvent ? { onEvent: (event: AiStreamEvent) => onEvent(event, { phase }) } : {}),
    });
    const initial = await request(scriptStoryboardPrompt(input), "generating");
    try {
      const draft = parseStructuredOutput(initial.content, scriptStoryboardDraftSchema);
      validateGrounding(draft, input);
      const storyboard = assembleStoryboard(draft);
      assertOriginalStoryboard(storyboard, input);
      return storyboard;
    } catch (error) {
      if (!(error instanceof TaskError) || error.code !== "AI_STRUCTURED_OUTPUT_INVALID") throw error;
      const repaired = await request(scriptStoryboardRepairPrompt(initial.content, input), "repairing");
      try {
        const draft = parseStructuredOutput(repaired.content, scriptStoryboardDraftSchema);
        validateGrounding(draft, input);
        const storyboard = assembleStoryboard(draft);
        assertOriginalStoryboard(storyboard, input);
        return storyboard;
      } catch (repairError) {
        throw new TaskError({
          code: "AI_FORMAT_REPAIR_FAILED",
          message: "分镜脚本修复后仍不符合执行约束",
          action: "retry",
          cause: repairError,
        });
      }
    }
  }
}
