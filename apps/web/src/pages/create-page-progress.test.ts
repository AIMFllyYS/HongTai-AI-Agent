import assert from "node:assert/strict";
import test from "node:test";

import { productionRenderStageCopy } from "./CreatePage";

test("制作进度文案只按稳定 stage 白名单映射，未知 stage 不猜业务", () => {
  assert.equal(productionRenderStageCopy("validate_avatar_audio"), "正在校验数字人口播原声");
  assert.equal(productionRenderStageCopy("synthesize_narration"), "正在生成旁白");
  assert.equal(productionRenderStageCopy("compile_shots"), "正在编排镜头");
  assert.equal(productionRenderStageCopy("export"), "正在本地合成");
  assert.equal(productionRenderStageCopy("saved"), "成片已保存");
  assert.equal(productionRenderStageCopy(""), "正在本地合成");
  assert.equal(productionRenderStageCopy("unknown_future_stage"), "正在本地合成");
  assert.equal(productionRenderStageCopy("正在生成旁白"), "正在本地合成");
});
