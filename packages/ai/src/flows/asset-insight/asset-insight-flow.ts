import { hasReadableText, hasVisibleText, TaskError } from "@hongtai/core";

import type { AssetInsightFlowDependencies, AssetInsightInput } from "../../contracts/asset-insight";
import { assetInsightPrompt } from "../../prompts/asset-insight";
import {
  assetInsightResponseJsonSchema,
  assetInsightResponseSchema,
  MAX_INSIGHT_FRAMES,
  type AssetInsightResponse,
  type AssetInsightResultV1,
} from "../../schemas/asset-insight";
import { parseStructuredOutput } from "../../structured-output/parse-structured-output";
import { visionUnavailable } from "../../vision";

function invalidInsight(message: string, cause?: unknown): TaskError {
  return new TaskError({ code: "AI_STRUCTURED_OUTPUT_INVALID", message, action: "retry", cause });
}

function assertFrames(input: AssetInsightInput): void {
  if (input.frames.length === 0) throw invalidInsight("没有可供识别的画面帧");
  if (input.frames.length > MAX_INSIGHT_FRAMES) throw invalidInsight(`一个素材最多识别 ${MAX_INSIGHT_FRAMES} 帧画面`);
  for (const frame of input.frames) {
    if (!frame.uri.trim()) throw invalidInsight("画面帧引用无效");
    if (!frame.mimeType.startsWith("image/") || frame.mimeType === "image/svg+xml") {
      throw invalidInsight("画面帧必须是位图图片");
    }
  }
}

/**
 * A description made of zero-width characters passes a length check and then shows the planner an
 * empty picture, so readability is checked on the characters that survive stripping.
 */
function assertReadable(value: AssetInsightResponse): void {
  if (!hasVisibleText(value.description)) throw invalidInsight("画面描述不能为空");
  for (const tag of value.tags) {
    if (!hasVisibleText(tag)) throw invalidInsight("画面标签不能为空");
  }
  if (new Set(value.tags).size !== value.tags.length) throw invalidInsight("画面标签不能重复");
}

/**
 * "Cannot be used" has to come with what to reshoot, and a usable frame must not carry a reason:
 * either half alone leaves the user with a card that says something is wrong but not what.
 */
function assertUsability(value: AssetInsightResponse): void {
  if (value.usable && value.unusableReason !== null) throw invalidInsight("可用素材不应附带不可用原因");
  // A reason of `。。。` clears a non-blank check and then tells the user to reshoot without saying
  // what was wrong, which is the same dead end as no reason at all.
  if (!value.usable && !(value.unusableReason && hasReadableText(value.unusableReason))) {
    throw invalidInsight("判定素材不可用时必须说清该重拍什么");
  }
}

/**
 * Describes what one imported asset actually shows.
 *
 * Unlike the planning and blueprint flows this has **no repair round**. A repair is a text-only
 * call, so a model asked to fix a rejected description can no longer see the picture and would
 * have to make one up — the exact failure this document exists to prevent. One honest attempt,
 * then the caller leaves the asset undescribed and says the plan was matched blind.
 */
export class AssetInsightFlow {
  readonly #dependencies: AssetInsightFlowDependencies;

  constructor(dependencies: AssetInsightFlowDependencies) {
    this.#dependencies = dependencies;
  }

  async run(input: AssetInsightInput): Promise<AssetInsightResultV1> {
    assertFrames(input);
    if (!input.assetId.trim()) throw invalidInsight("素材标识不能为空");

    let raw;
    try {
      raw = await this.#dependencies.provider.generate({
        model: "vision",
        output: "json",
        jsonSchema: { name: "asset_insight_v1", schema: assetInsightResponseJsonSchema, strict: true },
        maxOutputTokens: 1_024,
        messages: [
          { role: "system", content: assetInsightPrompt(input) },
          {
            role: "user",
            content: [
              { type: "text", text: "请只描述这些画面里看得见的内容。" },
              ...input.frames.map((frame) => ({ type: "image_uri" as const, uri: frame.uri, mimeType: frame.mimeType })),
            ],
          },
        ],
        ...(this.#dependencies.onEvent ? { onEvent: this.#dependencies.onEvent } : {}),
      });
    } catch (error) {
      throw visionUnavailable(error);
    }

    const value = parseStructuredOutput(raw.content, assetInsightResponseSchema);
    assertReadable(value);
    assertUsability(value);
    return {
      ...value,
      tags: [...value.tags],
      schemaVersion: "asset-insight.v1",
      assetId: input.assetId,
      describedFrameCount: input.frames.length,
    };
  }
}
