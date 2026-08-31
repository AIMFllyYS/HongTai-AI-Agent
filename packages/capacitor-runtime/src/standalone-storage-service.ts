import { TaskError } from "@hongtai/core";
import type {
  StorageAnalysisRecord,
  StorageAppDataGroup,
  StorageArea,
  StorageCacheClearResult,
  StorageItem,
  StorageItemKind,
  StorageService,
} from "@hongtai/core";

import type {
  NativeStorageItem,
  NativeStorageRole,
  NativeStorageSnapshot,
  StandaloneLocalStoragePlugin,
} from "./standalone-bridge.js";

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

function areaLabelFor(area: StorageArea): string {
  return {
    tasks: "拆解任务",
    observations: "观察记录",
    productions: "制作项目",
    templates: "模板数据",
    cache: "缓存与临时文件",
    "app-data": "应用配置",
  }[area];
}

/** 文案放在组合层（与 labelFor 一致）；未知目录名原样展示，不猜测含义。页面层展示分组构成时复用同一映射。 */
export function appDataGroupLabelFor(key: string): string {
  return {
    shared_prefs: "应用偏好",
    databases: "本地数据库",
    app_webview: "网页运行数据",
    no_backup: "系统免备份数据",
  }[key] ?? key;
}

function protectionReasonFor(item: NativeStorageItem): string | undefined {
  if (item.deletable) return undefined;
  if (item.protectionCode === "active") return "进行中的任务或制作不能删除媒体";
  if (item.protectionCode === "data") return "任务、报告、计划等数据文件必须保留，不能从这里删除";
  return "应用配置和运行数据由应用维护，不能从这里删除";
}

/**
 * relativePath 仅用于展示与分组，不合格的相对路径降级为空串而不是剔除整项：
 * 删除句柄是不透明 id，与路径无关，剔除会让用户失去清理入口。
 */
function normalizeRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  if (value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) return "";
  return value;
}

function normalizeItem(item: NativeStorageItem, requestedArea: StorageArea): StorageItem {
  if (!item.id || item.id.length > 160 || /[\\/]/u.test(item.id) || item.id.includes(String.fromCharCode(0))) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含无效项目", "retry");
  }
  if (item.area !== requestedArea || item.area === "app-data") {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含分区外项目", "retry");
  }
  if (!STORAGE_KINDS.includes(item.kind)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含未知项目", "retry");
  }
  if (!STORAGE_ROLES.includes(item.role)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含未知角色", "retry");
  }
  if (!validNumber(item.byteLength)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单包含无效大小", "retry");
  }
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const group = item.area === "observations" && typeof item.group === "string" && item.group.length > 0 ? item.group : undefined;
  return {
    id: item.id,
    area: item.area,
    kind: item.kind,
    label: title || labelFor(item.role),
    byteLength: item.byteLength,
    deletable: item.deletable === true,
    ...(protectionReasonFor(item) ? { protectionReason: protectionReasonFor(item) } : {}),
    relativePath: normalizeRelativePath(item.relativePath),
    ...(group ? { group } : {}),
  };
}

function generatedAt(epochMs: number, now: () => Date): string {
  return Number.isFinite(epochMs) && epochMs > 0
    ? new Date(epochMs).toISOString()
    : now().toISOString();
}

function normalizeAppDataGroups(groups: NativeStorageSnapshot["appDataGroups"]): readonly StorageAppDataGroup[] {
  if (!Array.isArray(groups)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储快照缺少应用配置分组", "retry");
  }
  return groups.map((group) => {
    if (!group || typeof group.key !== "string" || group.key.length === 0 || !validNumber(group.byteLength)) {
      throw storageError("STORAGE_READ_FAILED", "本地存储快照包含无效应用配置分组", "retry");
    }
    return { key: group.key, byteLength: group.byteLength };
  });
}

function normalizeSnapshot(snapshot: NativeStorageSnapshot, now: () => Date): StorageAnalysisRecord {
  if (snapshot.schemaVersion !== "native-storage.v2" || !Array.isArray(snapshot.areas)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储清单版本不受支持", "retry");
  }
  const device = snapshot.device;
  if (!device || !validNumber(device.totalBytes) || !validNumber(device.freeBytes)) {
    throw storageError("STORAGE_READ_FAILED", "本地存储快照缺少有效的设备容量", "retry");
  }
  const areas = STORAGE_AREAS.map((area) => {
    const summary = snapshot.areas.find((entry) => entry.area === area);
    if (!summary
      || !validNumber(summary.byteLength) || !validNumber(summary.itemCount)
      || !validNumber(summary.deletableByteLength) || !validNumber(summary.protectedByteLength)) {
      throw storageError("STORAGE_READ_FAILED", "本地存储快照分区不完整", "retry");
    }
    return {
      area,
      byteLength: summary.byteLength,
      itemCount: summary.itemCount,
      deletableByteLength: summary.deletableByteLength,
      protectedByteLength: summary.protectedByteLength,
    };
  });
  const totalByteLength = areas.reduce((sum, area) => sum + area.byteLength, 0);
  const deletableByteLength = areas.reduce((sum, area) => sum + area.deletableByteLength, 0);
  return {
    schemaVersion: "storage-analysis.v2",
    generatedAt: generatedAt(snapshot.generatedAtEpochMs, now),
    device: { totalByteLength: device.totalBytes, freeByteLength: device.freeBytes },
    totalByteLength,
    deletableByteLength,
    protectedByteLength: areas.reduce((sum, area) => sum + area.protectedByteLength, 0),
    areas,
    appDataGroups: normalizeAppDataGroups(snapshot.appDataGroups),
  };
}

function formatBytes(byteLength: number): string {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log2(byteLength) / 10));
  const value = byteLength / 2 ** (10 * exponent);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** 报告只含分区统计数字，不出现任何文件路径或逐项明细。 */
function renderReport(analysis: StorageAnalysisRecord): string {
  const lines: string[] = [
    "宏泰 AI Agent 存储分析报告",
    `生成时间：${new Date(analysis.generatedAt).toLocaleString("zh-CN")}`,
    "",
    `设备总容量：${formatBytes(analysis.device.totalByteLength)}`,
    `设备剩余可用：${formatBytes(analysis.device.freeByteLength)}`,
    "",
    `应用总占用：${formatBytes(analysis.totalByteLength)}`,
    `可定向清理：${formatBytes(analysis.deletableByteLength)}`,
    `受保护数据：${formatBytes(analysis.protectedByteLength)}`,
    "",
    "分区占用：",
  ];
  for (const area of analysis.areas) {
    lines.push(`- ${areaLabelFor(area.area)}：${formatBytes(area.byteLength)}（${area.itemCount} 项，可清理 ${formatBytes(area.deletableByteLength)}）`);
  }
  const appData = analysis.areas.find((area) => area.area === "app-data");
  if (analysis.appDataGroups.length > 0) {
    lines.push("", "应用配置构成：");
    for (const group of analysis.appDataGroups) {
      lines.push(`- ${appDataGroupLabelFor(group.key)}：${formatBytes(group.byteLength)}`);
    }
  } else if (appData && appData.byteLength > 0) {
    lines.push("", `应用配置构成：共 ${formatBytes(appData.byteLength)}，未提供分组明细。`);
  }
  return `${lines.join("\n")}\n`;
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
      return normalizeSnapshot(await this.#native.inspect(), this.#now);
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_READ_FAILED", "本地存储占用暂时无法读取", "retry");
    }
  }

  async listAreaItems(area: StorageArea): Promise<readonly StorageItem[]> {
    if (!STORAGE_AREAS.includes(area)) {
      throw storageError("STORAGE_READ_FAILED", "未知的存储分区", "none");
    }
    if (area === "app-data") {
      throw storageError("STORAGE_READ_FAILED", "应用配置不提供逐项列表", "none");
    }
    try {
      const listing = await this.#native.listAreaItems({ area });
      if (listing.schemaVersion !== "native-storage.v2" || listing.area !== area || !Array.isArray(listing.items)) {
        throw storageError("STORAGE_READ_FAILED", "本地存储清单版本不受支持", "retry");
      }
      const items = listing.items.map((item) => normalizeItem(item, area));
      for (const item of items) this.#lastItems.set(item.id, item);
      return items;
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_READ_FAILED", "本地存储清单暂时无法读取", "retry");
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
    this.#lastItems.delete(itemId);
    return this.inspect();
  }

  async clearCache(): Promise<{ readonly result: StorageCacheClearResult; readonly analysis: StorageAnalysisRecord }> {
    let cleared: { readonly deletedCount: number; readonly failedCount: number; readonly freedBytes: number };
    try {
      cleared = await this.#native.clearCache();
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_WRITE_FAILED", "缓存清理失败，已保留未删除的文件", "retry");
    }
    if (!cleared || !validNumber(cleared.deletedCount) || !validNumber(cleared.failedCount) || !validNumber(cleared.freedBytes)) {
      throw storageError("STORAGE_WRITE_FAILED", "缓存清理结果无效", "retry");
    }
    const result: StorageCacheClearResult = {
      deletedCount: cleared.deletedCount,
      failedCount: cleared.failedCount,
      freedByteLength: cleared.freedBytes,
    };
    for (const [id, item] of this.#lastItems) {
      if (item.area === "cache") this.#lastItems.delete(id);
    }
    return { result, analysis: await this.inspect() };
  }

  async exportReport(): Promise<void> {
    const analysis = await this.inspect();
    try {
      await this.#native.exportReport({ text: renderReport(analysis) });
    } catch (error) {
      if (error instanceof TaskError) throw error;
      throw storageError("STORAGE_WRITE_FAILED", "存储报告导出失败", "retry");
    }
  }
}
