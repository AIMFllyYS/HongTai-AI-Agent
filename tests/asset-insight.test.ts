import assert from "node:assert/strict";
import test from "node:test";

import { TaskError } from "../packages/core/src/index";
import type { AiGenerateRequest, AiGenerateResult, AiProvider } from "../packages/ai/src/contracts/provider";
import type { AssetInsightInput } from "../packages/ai/src/contracts/asset-insight";
import { AssetInsightFlow } from "../packages/ai/src/flows/asset-insight/asset-insight-flow";
import { assetInsightPrompt, assetInsightRepairPrompt } from "../packages/ai/src/prompts/asset-insight";
import { assetInsightResultSchema, type AssetInsightResponse } from "../packages/ai/src/schemas/asset-insight";

function input(overrides: Partial<AssetInsightInput> = {}): AssetInsightInput {
  return {
    assetId: "asset-1",
    kind: "video",
    frames: [
      { uri: "file:///private/productions/project-1/derived/asset-1-0.jpg", mimeType: "image/jpeg" },
      { uri: "file:///private/productions/project-1/derived/asset-1-1.jpg", mimeType: "image/jpeg" },
    ],
    ...overrides,
  };
}

function response(overrides: Partial<AssetInsightResponse> = {}): AssetInsightResponse {
  return {
    description: "店员站在前台后面，正对镜头说话，背后是货架和价目牌。",
    subject: "operator",
    tags: ["前台", "店员", "室内"],
    usable: true,
    unusableReason: null,
    ...overrides,
  };
}

function provider(contents: readonly string[]): AiProvider & { readonly requests: AiGenerateRequest[] } {
  const requests: AiGenerateRequest[] = [];
  let index = 0;
  return {
    requests,
    async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
      requests.push(request);
      const content = contents[Math.min(index, contents.length - 1)] ?? "";
      index += 1;
      return { content, reasoning: "这段推理不应该出现在任何产物里" };
    },
    async transcribe() { return ""; },
  };
}

async function run(contents: readonly string[], value = input()) {
  const dependencies = provider(contents);
  const flow = new AssetInsightFlow({ provider: dependencies });
  return { dependencies, result: await flow.run(value) };
}

async function rejection(contents: readonly string[], value = input()): Promise<TaskError> {
  const dependencies = provider(contents);
  const flow = new AssetInsightFlow({ provider: dependencies });
  try {
    await flow.run(value);
  } catch (error) {
    assert.ok(error instanceof TaskError, "失败必须是可分支的 TaskError");
    return error;
  }
  throw new Error("这次调用本应被拒绝");
}

test("素材理解只描述画面，并记下真正看了几帧", async () => {
  const { dependencies, result } = await run([JSON.stringify(response())]);

  assert.equal(result.schemaVersion, "asset-insight.v1");
  assert.equal(result.assetId, "asset-1");
  assert.equal(result.describedFrameCount, 2, "看了几帧是运行事实，不能由模型自己说");
  assert.equal(result.subject, "operator");
  assert.equal(assetInsightResultSchema.safeParse(result).success, true);

  const request = dependencies.requests[0]!;
  assert.equal(request.model, "vision", "描述画面必须走视觉模型");
  assert.equal(request.jsonSchema?.name, "asset_insight_v1");
  const images = (request.messages[1]?.content as readonly { readonly type: string }[]).filter((part) => part.type === "image_uri");
  assert.equal(images.length, 2, "两帧都要送进去，否则描述的是别的东西");
});

test("图片按单张说明，视频按整段说明，且都不告诉模型我们希望看到什么", async () => {
  const still = assetInsightPrompt(input({ kind: "image", frames: [input().frames[0]!] }));
  const clip = assetInsightPrompt(input());

  assert.match(still, /一张图片/u);
  assert.match(clip, /按时间顺序抽的帧/u);
  for (const prompt of [still, clip]) {
    assert.match(prompt, /不得猜测品牌/u);
    assert.match(prompt, /不得输出健康判断/u);
    assert.doesNotMatch(prompt, /清单|需求|应该拍|希望/u, "把期望画面写进提示词会把描述变成附和");
  }
});

test("没有帧、帧过多或非位图都当场拒绝，不去浪费一次视觉调用", async () => {
  const empty = await rejection([JSON.stringify(response())], input({ frames: [] }));
  assert.match(empty.message, /没有可供识别的画面帧/u);

  const tooMany = await rejection([JSON.stringify(response())], input({
    frames: Array.from({ length: 4 }, (_value, index) => ({ uri: `file:///f-${index}.jpg`, mimeType: "image/jpeg" })),
  }));
  assert.match(tooMany.message, /最多识别 3 帧/u);

  const vector = await rejection([JSON.stringify(response())], input({
    frames: [{ uri: "file:///f.svg", mimeType: "image/svg+xml" }],
  }));
  assert.match(vector.message, /必须是位图/u);
});

test("说不可用就必须说清重拍什么，可用就不能附带不可用原因", async () => {
  const silent = await rejection([JSON.stringify(response({ usable: false, unusableReason: null }))]);
  assert.match(silent.message, /该重拍什么/u);

  // Each of these reaches the user as a reshoot instruction that instructs nothing, which is the
  // same dead end as saying nothing at all.
  for (const empty of ["\u200b\u200b", "。。。", "...", "?", "—"]) {
    const blank = await rejection([JSON.stringify(response({ usable: false, unusableReason: empty }))]);
    assert.match(blank.message, /该重拍什么/u, `原因「${empty}」等于没说`);
  }

  // Two characters can be a real answer, so the gate must not become a length rule.
  const terse = await run([JSON.stringify(response({ usable: false, unusableReason: "太暗" }))]);
  assert.equal(terse.result.unusableReason, "太暗");

  const contradictory = await rejection([JSON.stringify(response({ usable: true, unusableReason: "太暗了" }))]);
  assert.match(contradictory.message, /不应附带不可用原因/u);

  const { result } = await run([JSON.stringify(response({ usable: false, unusableReason: "画面太暗，看不出主体，建议开灯重拍。" }))]);
  assert.equal(result.usable, false);
  assert.match(result.unusableReason ?? "", /重拍/u);
});

test("零宽描述、空标签和重复标签都不算看清了画面", async () => {
  const blankDescription = await rejection([JSON.stringify(response({ description: "\u200b\u200b\u200b" }))]);
  assert.match(blankDescription.message, /画面描述不能为空/u);

  const blankTag = await rejection([JSON.stringify(response({ tags: ["前台", "\u200b"] }))]);
  assert.match(blankTag.message, /画面标签不能为空/u);

  const duplicated = await rejection([JSON.stringify(response({ tags: ["前台", "前台"] }))]);
  assert.match(duplicated.message, /不能重复/u);
});

test("描述里出现确诊、概率或用药剂量时拒绝，素材审阅不是诊察", async () => {
  const diagnosed = await rejection([JSON.stringify(response({ description: "画面里这位顾客可以诊断为慢性咽炎。" }))]);
  assert.equal(diagnosed.code, "AI_STRUCTURED_OUTPUT_INVALID");

  const dosage = await rejection([JSON.stringify(response({ description: "桌上摆着每次 500 毫克的用药剂量说明。" }))]);
  assert.equal(dosage.code, "AI_STRUCTURED_OUTPUT_INVALID");
});

test("这一步没有修复轮：修复是纯文本调用，看不到图只能编", async () => {
  const dependencies = provider(["{不是 JSON", JSON.stringify(response())]);
  const flow = new AssetInsightFlow({ provider: dependencies });

  await assert.rejects(() => flow.run(input()), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "AI_STRUCTURED_OUTPUT_INVALID", "格式坏了就如实失败，交给调用方降级成盲配");
    return true;
  });
  assert.equal(dependencies.requests.length, 1, "只允许一次视觉调用");

  // The repair prompt exists for callers that can re-show the frames; it must not invite a rewrite.
  assert.match(assetInsightRepairPrompt("{", input()), /不要改变你实际看到的内容/u);
});

test("视觉模型不可用时给出可配置的稳定码，而不是笼统失败", async () => {
  const flow = new AssetInsightFlow({
    provider: {
      async generate() {
        throw new TaskError({ code: "AI_PERMISSION_DENIED", message: "没有权限", action: "configure_ai" });
      },
      async transcribe() { return ""; },
    },
  });

  await assert.rejects(() => flow.run(input()), (error: unknown) => {
    assert.ok(error instanceof TaskError);
    assert.equal(error.code, "AI_VISION_UNAVAILABLE");
    assert.equal(error.action, "configure_ai");
    return true;
  });
});
