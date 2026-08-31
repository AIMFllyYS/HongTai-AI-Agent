import assert from "node:assert/strict";
import test from "node:test";

import type {
  NativeStorageArea,
  NativeStorageItem,
  NativeStorageSnapshot,
  StandaloneLocalStoragePlugin,
} from "./standalone-bridge.js";
import { StandaloneStorageService } from "./standalone-storage-service.js";

const AREAS: readonly NativeStorageArea[] = ["tasks", "observations", "productions", "templates", "cache", "app-data"];

function emptyAreas(): NativeStorageSnapshot["areas"] {
  return AREAS.map((area) => ({ area, byteLength: 0, itemCount: 0, deletableByteLength: 0, protectedByteLength: 0 }));
}

function createSnapshot(overrides: Partial<NativeStorageSnapshot> = {}): NativeStorageSnapshot {
  return {
    schemaVersion: "native-storage.v2",
    generatedAtEpochMs: 1_700_000_000_000,
    device: { totalBytes: 128_000_000_000, freeBytes: 64_000_000_000 },
    areas: emptyAreas(),
    appDataGroups: [],
    ...overrides,
  };
}

interface FakeNative extends StandaloneLocalStoragePlugin {
  snapshot: NativeStorageSnapshot;
  readonly listings: Map<NativeStorageArea, NativeStorageItem[]>;
  readonly deleted: string[];
  readonly exported: string[];
  clearedCount: number;
}

function createNative(options: {
  readonly snapshot?: NativeStorageSnapshot;
  readonly items?: Partial<Record<NativeStorageArea, NativeStorageItem[]>>;
} = {}): FakeNative {
  const native: FakeNative = {
    snapshot: options.snapshot ?? createSnapshot(),
    listings: new Map(AREAS.map((area) => [area, [...(options.items?.[area] ?? [])]])),
    deleted: [],
    exported: [],
    clearedCount: 0,
    inspect: async () => native.snapshot,
    listAreaItems: async ({ area }) => {
      if (area === "app-data") throw new Error("app-data is not listable");
      return { schemaVersion: "native-storage.v2", area, generatedAtEpochMs: 1_700_000_000_000, items: native.listings.get(area) ?? [] };
    },
    deleteItem: async ({ itemId }) => {
      native.deleted.push(itemId);
      for (const [area, items] of native.listings) native.listings.set(area, items.filter((item) => item.id !== itemId));
    },
    clearCache: async () => {
      native.clearedCount += 1;
      const cache = native.listings.get("cache") ?? [];
      native.listings.set("cache", []);
      return { deletedCount: cache.length, failedCount: 0, freedBytes: cache.reduce((sum, item) => sum + item.byteLength, 0) };
    },
    exportReport: async ({ text }) => { native.exported.push(text); },
  };
  return native;
}

function snapshotWithAreas(bytes: Partial<Record<NativeStorageArea, { byteLength: number; itemCount: number; deletableByteLength: number }>>): NativeStorageSnapshot {
  return createSnapshot({
    areas: AREAS.map((area) => {
      const entry = bytes[area];
      const byteLength = entry?.byteLength ?? 0;
      const deletableByteLength = entry?.deletableByteLength ?? 0;
      return { area, byteLength, itemCount: entry?.itemCount ?? 0, deletableByteLength, protectedByteLength: byteLength - deletableByteLength };
    }),
  });
}

test("StandaloneStorageService validates and projects the v2 snapshot", async () => {
  const native = createNative({
    snapshot: {
      ...snapshotWithAreas({ tasks: { byteLength: 8_192, itemCount: 1, deletableByteLength: 8_192 }, cache: { byteLength: 128, itemCount: 1, deletableByteLength: 128 }, observations: { byteLength: 512, itemCount: 1, deletableByteLength: 0 } }),
      appDataGroups: [{ key: "shared_prefs", byteLength: 256 }, { key: "databases", byteLength: 1_024 }],
    },
  });
  const service = new StandaloneStorageService({ native, now: () => new Date("2026-08-26T00:00:00.000Z") });

  const snapshot = await service.inspect();
  assert.equal(snapshot.schemaVersion, "storage-analysis.v2");
  assert.equal(snapshot.generatedAt, new Date(1_700_000_000_000).toISOString());
  assert.deepEqual(snapshot.device, { totalByteLength: 128_000_000_000, freeByteLength: 64_000_000_000 });
  assert.equal(snapshot.totalByteLength, 8_832);
  assert.equal(snapshot.deletableByteLength, 8_320);
  assert.equal(snapshot.protectedByteLength, 512);
  assert.equal(snapshot.areas.length, 6);
  assert.equal(snapshot.areas.find((area) => area.area === "tasks")?.byteLength, 8_192);
  assert.deepEqual(snapshot.appDataGroups, [{ key: "shared_prefs", byteLength: 256 }, { key: "databases", byteLength: 1_024 }]);
});

test("StandaloneStorageService rejects legacy or incomplete snapshots", async () => {
  const legacy = createNative({
    snapshot: { schemaVersion: "native-storage.v1", generatedAtEpochMs: 1, items: [] } as unknown as NativeStorageSnapshot,
  });
  await assert.rejects(() => new StandaloneStorageService({ native: legacy }).inspect(), /本地存储清单版本不受支持/);

  const missingArea = createNative({
    snapshot: createSnapshot({ areas: emptyAreas().filter((area) => area.area !== "cache") }),
  });
  await assert.rejects(() => new StandaloneStorageService({ native: missingArea }).inspect(), /本地存储快照分区不完整/);

  const badDevice = createNative({
    snapshot: createSnapshot({ device: { totalBytes: -1, freeBytes: 0 } }),
  });
  await assert.rejects(() => new StandaloneStorageService({ native: badDevice }).inspect(), /设备容量/);
});

test("StandaloneStorageService composes labels, groups and sanitized relative paths per area", async () => {
  const native = createNative({
    items: {
      observations: [
        { id: "obs-tongue", area: "observations", kind: "image", role: "observation-image", byteLength: 512, deletable: true, title: "晨起舌象", group: "tongue", relativePath: "files/observations/a/image.jpg" },
        { id: "obs-face", area: "observations", kind: "image", role: "observation-image", byteLength: 256, deletable: true, group: "face", relativePath: "../outside.jpg" },
      ],
      tasks: [
        { id: "task-video", area: "tasks", kind: "video", role: "parsed-video", byteLength: 8_192, deletable: true, title: "  ", relativePath: "files\\tasks\\b\\video.mp4" },
        { id: "task-report", area: "tasks", kind: "document", role: "app-data", byteLength: 128, deletable: false, protectionCode: "data", relativePath: "/absolute/path.json" },
      ],
    },
  });
  const service = new StandaloneStorageService({ native });

  const observations = await service.listAreaItems("observations");
  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.label, "晨起舌象");
  assert.equal(observations[0]?.group, "tongue");
  assert.equal(observations[0]?.relativePath, "files/observations/a/image.jpg");
  // 空 title 回退到角色文案；越界相对路径降级为空串而不是剔除整项。
  assert.equal(observations[1]?.label, "观察图片");
  assert.equal(observations[1]?.relativePath, "");

  const tasks = await service.listAreaItems("tasks");
  assert.equal(tasks[0]?.label, "解析视频");
  assert.equal(tasks[0]?.relativePath, "");
  assert.equal(tasks[1]?.protectionReason, "任务、报告、计划等数据文件必须保留，不能从这里删除");
  assert.equal(tasks[1]?.relativePath, "");
  assert.equal("group" in tasks[0], false);

  await assert.rejects(() => service.listAreaItems("app-data"), /应用配置不提供逐项列表/);
});

test("StandaloneStorageService rejects native listings that escape the requested area", async () => {
  const native = createNative({
    items: {
      cache: [{ id: "stray", area: "tasks", kind: "video", role: "parsed-video", byteLength: 1, deletable: true, relativePath: "files/tasks/a/v.mp4" }],
    },
  });
  const service = new StandaloneStorageService({ native });
  await assert.rejects(() => service.listAreaItems("cache"), /分区外项目/);
});

test("StandaloneStorageService deletes one current media handle and refreshes the snapshot", async () => {
  const native = createNative({
    snapshot: snapshotWithAreas({ tasks: { byteLength: 2_048, itemCount: 1, deletableByteLength: 2_048 } }),
    items: {
      tasks: [{ id: "storage-video", area: "tasks", kind: "video", role: "user-video", byteLength: 2_048, deletable: true, relativePath: "files/tasks/a/video.mp4" }],
    },
  });
  const service = new StandaloneStorageService({ native });
  await service.listAreaItems("tasks");

  native.snapshot = snapshotWithAreas({});
  const after = await service.deleteItem("storage-video");
  assert.deepEqual(native.deleted, ["storage-video"]);
  assert.equal(after.totalByteLength, 0);
});

test("StandaloneStorageService refuses stale or protected delete handles", async () => {
  const native = createNative({
    items: {
      tasks: [{ id: "storage-report", area: "tasks", kind: "document", role: "app-data", byteLength: 128, deletable: false, protectionCode: "data", relativePath: "files/tasks/a/task.json" }],
    },
  });
  const service = new StandaloneStorageService({ native });
  await assert.rejects(() => service.deleteItem("storage-expired"), /存储清单已更新，请先重新读取/);

  await service.listAreaItems("tasks");
  await assert.rejects(() => service.deleteItem("storage-report"), /数据文件不能从这里删除/);
  assert.deepEqual(native.deleted, []);
});

test("StandaloneStorageService clears the cache area and returns a fresh snapshot", async () => {
  const native = createNative({
    items: {
      cache: [
        { id: "cache-1", area: "cache", kind: "temporary", role: "cache", byteLength: 128, deletable: true, relativePath: "cache/a.tmp" },
        { id: "cache-2", area: "cache", kind: "temporary", role: "cache", byteLength: 64, deletable: true, relativePath: "cache/b.tmp" },
      ],
    },
  });
  const service = new StandaloneStorageService({ native });
  await service.listAreaItems("cache");

  native.snapshot = snapshotWithAreas({});
  const { result, analysis } = await service.clearCache();
  assert.equal(native.clearedCount, 1);
  assert.deepEqual(result, { deletedCount: 2, failedCount: 0, freedByteLength: 192 });
  assert.equal(analysis.totalByteLength, 0);
  // 已清理的缓存句柄随之失效。
  await assert.rejects(() => service.deleteItem("cache-1"), /存储清单已更新，请先重新读取/);
});

test("StandaloneStorageService wraps invalid or failed cache clears", async () => {
  const invalid = createNative();
  invalid.clearCache = async () => ({ deletedCount: -1, failedCount: 0, freedBytes: 0 });
  await assert.rejects(() => new StandaloneStorageService({ native: invalid }).clearCache(), /缓存清理结果无效/);

  const failing = createNative();
  failing.clearCache = async () => { throw new Error("io"); };
  await assert.rejects(() => new StandaloneStorageService({ native: failing }).clearCache(), /缓存清理失败/);
});

test("StandaloneStorageService exports a statistics-only Chinese report", async () => {
  const native = createNative({
    snapshot: {
      ...snapshotWithAreas({ tasks: { byteLength: 4_096, itemCount: 2, deletableByteLength: 4_096 } }),
      appDataGroups: [{ key: "shared_prefs", byteLength: 128 }, { key: "custom_dir", byteLength: 64 }],
    },
  });
  const service = new StandaloneStorageService({ native, now: () => new Date("2026-08-26T00:00:00.000Z") });

  await service.exportReport();
  assert.equal(native.exported.length, 1);
  const report = native.exported[0] ?? "";
  assert.match(report, /存储分析报告/);
  assert.match(report, /设备总容量/);
  assert.match(report, /设备剩余可用/);
  assert.match(report, /应用总占用/);
  assert.match(report, /拆解任务：4\.0 KB（2 项/);
  assert.match(report, /应用偏好：128 B/);
  assert.match(report, /custom_dir：64\.0 B/);
  // 报告只允许分区统计数字，不得出现任何文件路径。
  assert.doesNotMatch(report, /files\//);
});
