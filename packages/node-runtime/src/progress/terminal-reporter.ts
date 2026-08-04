import type { ProgressEvent, ProgressReporter, TaskStage } from "@hongtai/core";

const STAGES: readonly TaskStage[] = [
  "detect-platform",
  "resolve-link",
  "parse-content",
  "select-media",
  "download-media",
  "obtain-transcript",
  "save-artifacts",
];

const LABELS: Readonly<Record<TaskStage, string>> = {
  "detect-platform": "识别平台",
  "resolve-link": "解析链接",
  "parse-content": "提取内容",
  "select-media": "选择视频",
  "download-media": "下载视频",
  "obtain-transcript": "获取文稿",
  "save-artifacts": "保存产物",
};

function formatBytes(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 1_024) return `${value}B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)}KB`;
  return `${(value / 1_048_576).toFixed(1)}MB`;
}
export class TerminalProgressReporter implements ProgressReporter {
  report(event: ProgressEvent): void {
    const index = STAGES.indexOf(event.stage) + 1;
    const label = LABELS[event.stage].padEnd(6, "　");
    const downloaded = formatBytes(event.detail?.downloadedBytes);
    const total = formatBytes(event.detail?.totalBytes);
    const size = downloaded ? `｜${downloaded}${total ? ` / ${total}` : ""}` : "";
    console.log(`[${index}/7] ${label} ${event.message}${size}`);
  }
}
