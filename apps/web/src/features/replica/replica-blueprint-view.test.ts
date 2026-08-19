import assert from "node:assert/strict";
import test from "node:test";

import { MIN_MONTAGE_VISUAL_ASSETS, type ProductionAsset, type VersionedDocument } from "@hongtai/core";

import {
  MIN_BOUND_REQUIREMENTS,
  readReplicaBlueprint,
  requirementBindings,
  requirementRoleLabel,
  skipEffectHint,
  unboundAssetCount,
  wizardReadiness,
} from "./replica-blueprint-view";

function shot(order: number, seconds: number): Record<string, unknown> {
  return {
    order,
    role: "proof",
    subject: "environment",
    visualDescription: `第 ${order} 段要拍的画面`,
    material: { kind: "video", contentHint: `第 ${order} 段素材`, suggestedDurationSeconds: seconds },
    scriptDraft: `第 ${order} 段可以这样说。`,
    evidenceRefs: ["transcript-1"],
  };
}

function document(shots: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): VersionedDocument {
  return {
    schemaVersion: "replica-blueprint.v1",
    document: {
      schemaVersion: "replica-blueprint.v1",
      premise: "按流程一段段拍就能复刻。",
      suggestedTemplateId: "keyword_pop",
      shots,
      emptyReason: null,
      ...overrides,
    } as never,
  };
}

function asset(id: string, requirementOrder?: number): ProductionAsset {
  return {
    id,
    role: "visual",
    uri: `capacitor://localhost/private/${id}.mp4`,
    kind: "video",
    origin: "imported",
    mimeType: "video/mp4",
    displayName: `${id}.mp4`,
    byteLength: 100,
    ...(requirementOrder === undefined ? {} : { requirementOrder }),
  };
}

test("清单按项号排序读取，缺字段的项直接丢掉而不是补默认值", () => {
  const view = readReplicaBlueprint(document([shot(3, 12), shot(1, 6), { order: 2 }]));

  assert.deepEqual(view.requirements.map((item) => item.order), [1, 3], "只有 order 的项无法指导拍摄，不该显示成一项");
  assert.equal(view.totalSuggestedSeconds, 18);
  assert.equal(view.usable, true);
  assert.equal(view.premise, "按流程一段段拍就能复刻。");
});

test("空清单不可用，但把原因带出来给用户看", () => {
  const view = readReplicaBlueprint(document([], { emptyReason: "转写只有寒暄，说不出可拍的画面。" }));

  assert.equal(view.usable, false);
  assert.equal(view.emptyReason, "转写只有寒暄，说不出可拍的画面。");
  assert.equal(view.totalSuggestedSeconds, 0);
});

test("不是 replica-blueprint.v1 的文档一律当没有清单", () => {
  assert.equal(readReplicaBlueprint(undefined).usable, false);
  assert.equal(readReplicaBlueprint({ schemaVersion: "production-plan.v3", document: {} as never }).usable, false);
});

test("绑定关系从素材上读，删掉素材那一项立刻回到未绑定", () => {
  const view = readReplicaBlueprint(document([shot(1, 6), shot(2, 12), shot(3, 12)]));
  const bound = requirementBindings(view.requirements, [asset("asset-b", 2), asset("asset-a", 1)]);

  assert.deepEqual(bound.map((item) => [item.requirement.order, item.asset?.id]), [[1, "asset-a"], [2, "asset-b"], [3, undefined]]);

  const afterRemoval = requirementBindings(view.requirements, [asset("asset-b", 2)]);
  assert.equal(afterRemoval[0]?.asset, undefined, "素材没了，第 1 项不能还显示成已完成");
});

test("不够三项时不能开工，并说清还差几项", () => {
  const view = readReplicaBlueprint(document([shot(1, 6), shot(2, 12), shot(3, 12)]));
  const two = wizardReadiness(requirementBindings(view.requirements, [asset("asset-a", 1), asset("asset-b", 2)]));

  assert.equal(two.ready, false);
  assert.equal(two.boundCount, 2);
  assert.match(two.blockedReason, /还需要 1 项素材/u);

  const three = wizardReadiness(requirementBindings(view.requirements, [asset("asset-a", 1), asset("asset-b", 2), asset("asset-c", 3)]));
  assert.equal(three.ready, true);
  assert.equal(three.blockedReason, "");
  assert.equal(MIN_BOUND_REQUIREMENTS, MIN_MONTAGE_VISUAL_ASSETS, "UI 的门槛必须就是合成端的门槛，不能各写一个数");
});

test("跳过清单项不会让成片变短，提示要说出时长去哪了", () => {
  const view = readReplicaBlueprint(document([shot(1, 6), shot(2, 12), shot(3, 12), shot(4, 10)]));
  const bindings = requirementBindings(view.requirements, [asset("asset-a", 1), asset("asset-b", 2), asset("asset-c", 3)]);

  const hint = skipEffectHint(bindings, 40);
  assert.match(hint, /跳过的 1 项不会缩短成片/u);
  assert.match(hint, /平均每个约 13\.3 秒/u);

  const all = requirementBindings(view.requirements, [asset("asset-a", 1), asset("asset-b", 2), asset("asset-c", 3), asset("asset-d", 4)]);
  assert.equal(skipEffectHint(all, 40), "", "一项都没跳过时不该提示");
  assert.equal(skipEffectHint(bindings.map(({ requirement }) => ({ requirement })), 40), "", "还没开始绑定时不该提示");
});

test("清单外导入的画面素材单独计数，不会被当成某一项", () => {
  assert.equal(unboundAssetCount([asset("asset-a", 1), asset("asset-b")]), 1);
  assert.equal(unboundAssetCount([{ ...asset("music-1"), role: "music", kind: "audio" }]), 0, "背景音乐不是清单项的素材");
});

test("镜头角色显示中文，未知角色保留原值而不是显示空白", () => {
  assert.equal(requirementRoleLabel("hook"), "开场钩子");
  assert.equal(requirementRoleLabel("unmapped_role"), "unmapped_role");
});
