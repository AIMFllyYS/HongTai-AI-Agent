import { TaskError } from "@hongtai/core";
import type {
  StorageAnalysisRecord,
  StorageArea,
  StorageItem,
  StorageItemKind,
  StorageService,
} from "@hongtai/core";

import type { NativeStorageItem, NativeStorageRole, StandaloneLocalStoragePlugin } from "./standalone-bridge.js";

const STORAGE_AREAS: readonly StorageArea[] = ["tasks", "observations", "productions", "templates", "cache", "app-data"];
const STORAGE_KINDS: readonly StorageItemKind[] = ["video", "image", "audio", "document", "temporary", "other"];

function storageError(
  code: ConstructorParameters<typeof TaskError>[0]["code"],
  message: string,
  action: ConstructorParameters<typeof TaskError>[0]["action"] = "free_storage",
): TaskError {
  return new TaskError({ code, message, action });
}

function validNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

const STORAGE_ROLES: readonly NativeStorageRole[] = [
  "user-video", "parsed-video", "parsed-audio", "parsed-image", "observation-image",
  "production-asset", "production-output", "derived-frame", "template-media", "cache", "app-data", "protected-other",
];

function labelFor(role: NativeStorageRole): string {
  return {
    "user-video": "用户上传视频",
    "parsed-video": "解析视频",
    "parsed-audio": "解析音频",
    "parsed-image": "解析图片",
    "observation-image": "观察图片",
    "production-asset": "制作素材",
    "production-output": "已生成成片",
    "derived-frame": "分析派生帧",
    "template-media": "模板素材",
    cache: "缓存文件",
    "app-data": "应用配置文件",
    "protected-other": "本地运行文件",
  }[role];
}

function protectionReasonFor(item: NativeStorageItem): string | undefined {
  if (item.deletable) return undefined;
  if (item.protectionCode === "active") return "进行中的任务或制作不能删除媒体";
  if (item.protectionCode === "data") return "任务、报告、计划等数据文件必须保留，不能从这里删除";
  return "应用配置和运行数据由应用维护，不能从这里删除";
}

function normalizeItem(item: NativeStorageItem): StorageItem {
  if (!item.id || item.id.length > 160 || /[\\/]/u.test(item.id) || item.id.includes(String.fromCharCode(0))) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含无效项目", "retry");
  }
  if (!STORAGE_AREAS.includes(item.area) || !STORAGE_KINDS.includes(item.kind)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含未知项目", "retry");
  }
  if (!STORAGE_ROLES.includes(item.role)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含未知角色", "retry");
  }
  if (!validNumber(item.byteLength)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含无效大小", "retry");
  }
  return {
    id: item.id,
    area: item.area,
    kind: item.kind,
    label: labelFor(item.role),
    byteLength: item.byteLength,
    deletable: item.deletable === true,
    ...(protectionReasonFor(item) ? { protectionReason: protectionReasonFor(item) } : {}),
  };
}

function generatedAt(epochMs: number, now: () => Date): string {
  return Number.isFinite(epochMs) && epochMs > 0
    ? new Date(epochMs).toISOString()
    : now().toISOString();
}

export class StandaloneStorageService implements StorageService {
  readonly #native: StandaloneLocalStoragePlugin;
  readonly #now: () => Date;
  #lastItems = new Map<string, StorageItem>();

  constructor(options: { readonly native: StandaloneLocalStoragePlugin; readonly now?: () => Date }) {
    this.#native = options.native;
    this.#now = options.now ?? (() => new Date());
  }

  async inspect(): Promise<StorageAnalysisRecord> {
    try {
      const snapshot = await this.#native.inspect();
      if (snapshot.schemaVersion !== "native-storage.v1" || !Array.isArray(snapshot.items)) {
        throw storageError("STORAGE_READ_FAILED", "本地存储清单版本不受支持", "retry");
      }
      const items = snapshot.items.map(normalizeItem);
      this.#lastItems = new Map(items.map((item) => [item.id, item]));
      return this.#project(items, generatedAt(snapshot.generatedAtEpochMs, this.#now));
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_READ_FAILED", "本地存储占用暂时无法读取", "retry");
    }
  }

  async deleteItem(itemId: string): Promise<StorageAnalysisRecord> {
    const item = this.#lastItems.get(itemId);
    if (!item) throw storageError("STORAGE_READ_FAILED", "存储清单已更新，请先重新读取", "retry");
    if (!item.deletable) throw storageError("STORAGE_WRITE_FAILED", "数据文件不能从这里删除", "none");
    try {
      await this.#native.deleteItem({ itemId });
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_WRITE_FAILED", "定向删除存储项目失败，原文件仍保留", "retry");
    }
    return this.inspect();
  }

  #project(items: readonly StorageItem[], generatedAtValue: string): StorageAnalysisRecord {
    const areas = STORAGE_AREAS.map((area) => {
      const members = items.filter((item) => item.area === area);
      const byteLength = members.reduce((sum, item) => sum + item.byteLength, 0);
      const deletableByteLength = members.filter((item) => item.deletable).reduce((sum, item) => sum + item.byteLength, 0);
      return {
        area,
        byteLength,
        itemCount: members.length,
        deletableByteLength,
        protectedByteLength: byteLength - deletableByteLength,
      };
    });
    const totalByteLength = items.reduce((sum, item) => sum + item.byteLength, 0);
    const deletableByteLength = items.filter((item) => item.deletable).reduce((sum, item) => sum + item.byteLength, 0);
    return {
      schemaVersion: "storage-analysis.v1",
      generatedAt: generatedAtValue,
      totalByteLength,
      deletableByteLength,
      protectedByteLength: totalByteLength - deletableByteLength,
      areas,
      items,
    };
  }
}
