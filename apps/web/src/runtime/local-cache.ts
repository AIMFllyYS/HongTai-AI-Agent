export function formatByteSize(bytes: number | undefined, emptyLabel = "可清理"): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return emptyLabel;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
}

export function formatStoredSize(bytes: number | undefined): string {
  return formatByteSize(bytes, "未解析到");
}

export function totalMediaByteLength(media: readonly { readonly byteLength?: number }[]): number | undefined {
  let total = 0;
  let found = false;
  for (const item of media) {
    if (typeof item.byteLength === "number" && Number.isFinite(item.byteLength) && item.byteLength >= 0) {
      total += item.byteLength;
      found = true;
    }
  }
  return found ? total : undefined;
}

export async function estimateCacheUsageBytes(): Promise<number | undefined> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return undefined;
  const estimate = await navigator.storage.estimate();
  return typeof estimate.usage === "number" ? estimate.usage : undefined;
}

export async function clearAppCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}
