import { pathForRoute } from "../router";

export type ComposeAction = "agent" | "replica" | "paste";

export interface ComposeActionItem {
  readonly id: ComposeAction;
  readonly title: string;
  readonly description: string;
}

export const composeActions: readonly ComposeActionItem[] = [
  { id: "agent", title: "智能成片", description: "AI 写旁白与字幕，导入素材即可" },
  { id: "replica", title: "爆款复刻", description: "按分镜清单逐项拍摄" },
  { id: "paste", title: "拆解新链接", description: "粘贴链接开始分析" },
];

export function pathForComposeAction(action: ComposeAction): string {
  if (action === "agent") return `${pathForRoute("create")}?entry=agent`;
  if (action === "replica") return `${pathForRoute("create")}?entry=replica`;
  return `${pathForRoute("home")}?intent=paste`;
}

export function composeEntryFromSearch(search: string): "agent" | "replica" | "" {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    const value = new URLSearchParams(raw).get("entry")?.trim();
    return value === "agent" || value === "replica" ? value : "";
  } catch {
    return "";
  }
}

export function pasteIntentFromSearch(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    return new URLSearchParams(raw).get("intent")?.trim() === "paste";
  } catch {
    return false;
  }
}

function stripSearchParams(search: string, keys: readonly string[]): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    const params = new URLSearchParams(raw);
    for (const key of keys) params.delete(key);
    const next = params.toString();
    return next ? `?${next}` : "";
  } catch {
    return "";
  }
}

export function consumeSearchParams(keys: readonly string[]): void {
  if (typeof window === "undefined") return;
  const nextSearch = stripSearchParams(window.location.search, keys);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash ?? ""}`;
  const next = `${window.location.pathname}${nextSearch}${window.location.hash ?? ""}`;
  if (current !== next) window.history.replaceState(window.history.state ?? {}, "", next);
}

export function consumeComposeEntryFromSearch(): "agent" | "replica" | "" {
  if (typeof window === "undefined") return "";
  const entry = composeEntryFromSearch(window.location.search);
  if (entry) consumeSearchParams(["entry"]);
  return entry;
}

export function consumePasteIntentFromSearch(): boolean {
  if (typeof window === "undefined") return false;
  const present = pasteIntentFromSearch(window.location.search);
  if (present) consumeSearchParams(["intent"]);
  return present;
}
