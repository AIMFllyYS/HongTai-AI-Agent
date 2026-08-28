import { DECORATION_IDS, MAX_SCRIPT_SENTENCE_CHARACTERS, MAX_SHOTS_PER_PRODUCTION } from "@hongtai/core";
import { z } from "zod";

import { toProviderJsonSchema } from "../structured-output/json-schema";

/**
 * 模型产出的分镜草稿（文稿先行管线的第一步）。
 *
 * 模型只写「说什么」与「建议绑什么」：文案、素材绑定建议、贴纸建议与整体用途。句子的
 * `id` 与 `estimatedMs` 由调用方在本地生成——让模型填毫秒数历史上产生过对不齐的时间轴
 * （#107），分镜阶段不重蹈；最终一致性由 core 的 `parseScriptStoryboard` 把关。
 */
const scriptSentenceDraftSchema = z.object({
  /** 一句完整、自然、可直接朗读的中文口播。 */
  text: z.string().min(1).max(MAX_SCRIPT_SENTENCE_CHARACTERS),
  /** 素材绑定建议：只能引用输入素材清单中的 id；无合适素材时省略，不得编造。 */
  assetId: z.string().min(1).optional(),
  /** 贴纸建议：内置装饰清单 id；不需要贴纸时省略。 */
  stickerId: z.enum(DECORATION_IDS).optional(),
});

export const scriptStoryboardDraftSchema = z.object({
  /** 整体用途说明（如「门店服务介绍」），供界面回显，不参与渲染。 */
  purpose: z.string().min(1).max(80).optional(),
  sentences: z.array(scriptSentenceDraftSchema).min(1).max(MAX_SHOTS_PER_PRODUCTION),
});

export type ScriptSentenceDraft = z.infer<typeof scriptSentenceDraftSchema>;
export type ScriptStoryboardDraft = z.infer<typeof scriptStoryboardDraftSchema>;

export const scriptStoryboardDraftJsonSchema = toProviderJsonSchema(scriptStoryboardDraftSchema);
