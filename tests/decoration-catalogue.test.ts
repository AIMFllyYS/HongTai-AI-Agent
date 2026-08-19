import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DECORATION_CATALOGUE,
  DECORATION_IDS,
  DECORATION_CAPTION_GAP_PX,
  DECORATION_INSET_PX,
  DECORATION_MAX_BYTES,
  DECORATION_MAX_EDGE_PX,
  DECORATION_MAX_WIDTH_SHARE,
  DECORATION_PIXEL_SIZE,
  DECORATION_PUBLIC_DIR,
  DECORATION_TOP_INSET_PX,
  decorationAssetManagerPath,
  decorationPublicUrl,
  decorationRelativePath,
} from "../packages/core/src/index";

const root = process.cwd();
const pngDir = join(root, "apps", "web", "public", DECORATION_PUBLIC_DIR);
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

test("内置贴纸清单与 PNG 一一对应，没有多余文件，且尺寸字节在上限内", () => {
  assert.equal(DECORATION_IDS.length, DECORATION_CATALOGUE.length);
  assert.ok(DECORATION_IDS.length >= 6 && DECORATION_IDS.length <= 8);

  const listed = new Set(DECORATION_CATALOGUE.map((item) => item.relativePath.split("/").at(-1)));
  const files = readdirSync(pngDir).filter((name) => name.endsWith(".png"));
  assert.deepEqual([...files].sort(), [...listed].sort(), "PNG 目录不能有清单外的文件");

  for (const item of DECORATION_CATALOGUE) {
    const assetPath = join(root, "apps", "web", "public", item.relativePath);
    assert.equal(existsSync(assetPath), true, `${item.relativePath} 应存在`);
    assert.equal(item.relativePath, decorationRelativePath(item.id));
    assert.equal(decorationPublicUrl(item.id), `/${item.relativePath}`);
    assert.equal(decorationAssetManagerPath(item.id), `public/${item.relativePath}`);

    const bytes = readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], PNG_MAGIC, `${item.id} 必须是 PNG`);
    assert.equal(bytes[25], 6, `${item.id} 必须带 RGBA 透明通道`);
    assert.equal(bytes.readUInt32BE(16), DECORATION_PIXEL_SIZE);
    assert.equal(bytes.readUInt32BE(20), DECORATION_PIXEL_SIZE);
    assert.ok(bytes.readUInt32BE(16) <= DECORATION_MAX_EDGE_PX);
    assert.ok(statSync(assetPath).size <= DECORATION_MAX_BYTES, `${item.id} 超出字节上限`);
    assert.ok(item.label.length > 0 && item.tags.length > 0);
  }
});

test("Web 预览与 Kotlin 使用同一份相对路径和锚点 inset", () => {
  const preview = readFileSync(join(root, "apps/web/src/components/ProductionDecorationPreview.tsx"), "utf8");
  const kotlinAssets = readFileSync(join(root, "android/app/src/main/java/com/hongtai/aiagent/production/DecorationAssets.kt"), "utf8");
  const kotlinGeometry = readFileSync(join(root, "android/app/src/main/java/com/hongtai/aiagent/production/SubtitleOverlayGeometry.kt"), "utf8");
  const plugin = readFileSync(join(root, "android/app/src/main/java/com/hongtai/aiagent/bridge/ProductionRuntimePlugin.kt"), "utf8");

  assert.match(preview, /decorationPublicUrl\(item\.assetRef\)/);
  assert.doesNotMatch(preview, /@hongtai\/ai/);
  assert.match(kotlinAssets, /ASSET_PREFIX = "public"/);
  assert.match(kotlinAssets, /RELATIVE_DIR = "decorations"/);
  assert.match(kotlinAssets, /\$ASSET_PREFIX\/\$RELATIVE_DIR\/\$id\.png/);
  assert.match(plugin, /DecorationAssets\.exists\(context\.assets, id\)/);
  assert.match(kotlinGeometry, new RegExp(`DECORATION_INSET_PX = ${DECORATION_INSET_PX}f`));
  assert.match(kotlinGeometry, new RegExp(`DECORATION_TOP_INSET_PX = ${DECORATION_TOP_INSET_PX}f`));
  assert.match(kotlinGeometry, new RegExp(`DECORATION_CAPTION_GAP_PX = ${DECORATION_CAPTION_GAP_PX}f`));
  assert.match(kotlinGeometry, new RegExp(`DECORATION_MAX_WIDTH_SHARE = ${DECORATION_MAX_WIDTH_SHARE}f`));
});
