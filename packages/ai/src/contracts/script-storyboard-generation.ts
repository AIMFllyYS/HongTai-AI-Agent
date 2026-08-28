import type { ContentAnalysisResultV1 } from "../schemas/content-analysis";
import type { AiProvider, AiStreamEvent } from "./provider";

/**
 * 素材画面识别结果里供分镜绑定建议使用的部分（`asset-insight.v1` 的描述性半份）。
 * 判断素材可用与否是给用户重拍的消息，不是分镜撰写的输入，因此不进入本契约。
 */
export interface ScriptGenerationAssetInsight {
  readonly description: string;
  readonly tags?: readonly string[];
}

/** 分镜脚本生成可引用的项目素材。 */
export interface ScriptGenerationAsset {
  readonly id: string;
  readonly kind: "image" | "video" | "audio";
  /** visual 普通画面素材；avatar 口播切片源视频；music 音频素材。 */
  readonly role: "visual" | "avatar" | "music";
  readonly durationSeconds?: number;
  /** 画面已识别时提供；绑定建议必须贴合描述，未识别素材的句子不得具体描述画面。 */
  readonly insight?: ScriptGenerationAssetInsight;
}

export interface ScriptGenerationInput {
  /** 一句话制作需求，必填。 */
  readonly brief: string;
  /** montage 素材剪辑模式；avatar 口播切片模式（用户自带口播视频）。 */
  readonly mode: "montage" | "avatar";
  /** 可选参考拆解结果：只吸收结构与思路，不照抄措辞。省略表示本次无参考拆解。 */
  readonly analysis?: ContentAnalysisResultV1;
  /** 可选素材清单（含画面识别结果），供素材绑定建议 grounding。省略表示本次没有可用素材。 */
  readonly assets?: readonly ScriptGenerationAsset[];
}

export interface ScriptGenerationFlowDependencies {
  readonly provider: AiProvider;
  readonly onEvent?: (event: AiStreamEvent) => void | Promise<void>;
}
