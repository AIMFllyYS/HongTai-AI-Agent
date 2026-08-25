import assert from "node:assert/strict";
import test from "node:test";

import type { NativeStorageItem, StandaloneLocalStoragePlugin } from "./standalone-bridge.js";
import { StandaloneStorageService } from "./standalone-storage-service.js";

function createNative(initial: readonly NativeStorageItem[]): StandaloneLocalStoragePlugin & { readonly deleted: string[] } {
  let items = [...initial];
  const deleted: string[] = [];
  return {
    deleted,
    inspect: async () => ({ schemaVersion: "native-storage.v1", generatedAtEpochMs: 1_700_000_000_000, items }),
    deleteItem: async ({ itemId }) => {
      deleted.push(itemId);
      items = items.filter((item) => item.id !== itemId);
    },
  };
}

test("StandaloneStorageService aggregates real item bytes and keeps protected data visible", async () => {
  const native = createNative([
    { id: "storage-video", area: "tasks", kind: "video", role: "parsed-video", byteLength: 8_192, deletable: true },
    { id: "storage-report", area: "observations", kind: "document", role: "app-data", byteLength: 512, deletable: false, protectionCode: "data" },
    { id: "storage-cache", area: "cache", kind: "temporary", role: "cache", byteLength: 128, deletable: true },
  ]);
  const service = new StandaloneStorageService({ native, now: () => new Date("2026-08-26T00:00:00.000Z") });

  const snapshot = await service.inspect();
  assert.equal(snapshot.schemaVersion, "storage-analysis.v1");
  assert.equal(snapshot.totalByteLength, 8_832);
  assert.equal(snapshot.deletableByteLength, 8_320);
  assert.equal(snapshot.protectedByteLength, 512);
  assert.equal(snapshot.areas.find((area) => area.area === "tasks")?.byteLength, 8_192);
  assert.equal(snapshot.items.find((item) => item.id === "storage-report")?.deletable, false);
  await assert.rejects(() => service.deleteItem("storage-report"), /数据文件不能从这里删除/);
});

test("StandaloneStorageService deletes one current media handle and refreshes the snapshot", async () => {
  const native = createNative([
    { id: "storage-video", area: "tasks", kind: "video", role: "user-video", byteLength: 2_048, deletable: true },
  ]);
  const service = new StandaloneStorageService({ native });
  await service.inspect();

  const after = await service.deleteItem("storage-video");
  assert.deepEqual(native.deleted, ["storage-video"]);
  assert.equal(after.totalByteLength, 0);
  assert.equal(after.items.length, 0);
});

test("StandaloneStorageService refuses stale delete handles", async () => {
  const native = createNative([]);
  const service = new StandaloneStorageService({ native });
  await assert.rejects(() => service.deleteItem("storage-expired"), /存储清单已更新，请先重新读取/);
});
