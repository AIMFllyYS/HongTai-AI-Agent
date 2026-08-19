import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveDecorationTimeline, stickerIntent } from "../packages/ai/src/flows/production/production-decoration-timeline";

const twoCueShot = { order: 1, cues: [{ startMs: 0, endMs: 4000 }, { startMs: 4000, endMs: 8000 }] } as const;
const oneCueShot = { order: 1, cues: [{ startMs: 0, endMs: 8000 }] } as const;

test("第一条装饰落在该镜 cue 0", () => {
  const derived = deriveDecorationTimeline(
    [stickerIntent({ shotOrder: 1, assetRef: "arrow_right", anchor: "top_right", scale: 1, animation: "fade" })],
    [twoCueShot],
  );
  assert.equal(derived.length, 1);
  assert.equal(derived[0]?.startMs, twoCueShot.cues[0].startMs);
  assert.equal(derived[0]?.endMs, twoCueShot.cues[0].endMs);
});

test("同一镜头第二条装饰落在 cue 1", () => {
  const derived = deriveDecorationTimeline(
    [
      stickerIntent({ shotOrder: 1, assetRef: "arrow_right", anchor: "top_right", scale: 1, animation: "fade" }),
      stickerIntent({ shotOrder: 1, assetRef: "star_mark", anchor: "middle_right", scale: 1, animation: "pop" }),
    ],
    [twoCueShot],
  );
  assert.equal(derived[0]?.startMs, 0);
  assert.equal(derived[0]?.endMs, 4000);
  assert.equal(derived[1]?.startMs, 4000);
  assert.equal(derived[1]?.endMs, 8000);
});

test("单 cue 镜头上的两条装饰复用那一条窗口，而不是丢掉", () => {
  const derived = deriveDecorationTimeline(
    [
      stickerIntent({ shotOrder: 1, assetRef: "arrow_right", anchor: "top_right", scale: 1, animation: "none" }),
      stickerIntent({ shotOrder: 1, assetRef: "sparkle", anchor: "above_caption", scale: 1, animation: "none" }),
    ],
    [oneCueShot],
  );
  assert.equal(derived.length, 2);
  assert.equal(derived[0]?.startMs, 0);
  assert.equal(derived[0]?.endMs, 8000);
  assert.equal(derived[1]?.startMs, 0);
  assert.equal(derived[1]?.endMs, 8000);
});

test("装饰时间落在所属镜头内，且是整毫秒", () => {
  const shot = { order: 2, cues: [{ startMs: 0, endMs: 1234 }] } as const;
  const derived = deriveDecorationTimeline(
    [stickerIntent({ shotOrder: 2, assetRef: "check_mark", anchor: "middle_left", scale: 1.2, animation: "float" })],
    [{ order: 1, cues: [{ startMs: 0, endMs: 5000 }] }, shot],
  );
  assert.equal(derived[0]?.shotOrder, 2);
  assert.equal(derived[0]?.startMs, 0);
  assert.equal(derived[0]?.endMs, 1234);
  assert.equal(Number.isInteger(derived[0]?.startMs), true);
  assert.equal(Number.isInteger(derived[0]?.endMs), true);
  assert.ok((derived[0]?.startMs ?? -1) >= 0);
  assert.ok((derived[0]?.endMs ?? -1) <= shot.cues[0].endMs);
});
