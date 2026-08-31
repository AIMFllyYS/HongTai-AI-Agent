import { useCallback, useEffect, useMemo, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, StorageArea, StorageItem, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { ConfirmDeleteSheet } from "../components/ConfirmDeleteSheet";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState, ErrorState } from "../components/StatePanels";
import { useNotification } from "../notifications/NotificationProvider";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { storageAnalysisPath } from "../router";
import { formatByteSize } from "../runtime/local-cache";

export interface StorageAreaPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
  /** Raw route parameter; only drillable areas render a listing. */
  readonly area: string;
}

const DRILLABLE_AREAS = ["tasks", "observations", "productions", "templates"] as const satisfies readonly StorageArea[];
type DrillableArea = (typeof DRILLABLE_AREAS)[number];

const AREA_TITLES: Readonly<Record<DrillableArea, string>> = {
  tasks: "拆解任务",
  observations: "舌诊面诊",
  productions: "制作项目",
  templates: "模板数据",
};

function isDrillableArea(area: string): area is DrillableArea {
  return (DRILLABLE_AREAS as readonly string[]).includes(area);
}

function itemIcon(item: StorageItem): IconName {
  if (item.kind === "video") return "video";
  if (item.kind === "image") return "image";
  if (item.kind === "document") return "file_text";
  if (item.kind === "temporary") return "trash_2";
  return "folder";
}

interface ItemGroup {
  readonly key: string;
  readonly title: string;
  readonly items: readonly StorageItem[];
}

/** 观察记录按舌诊/面诊分组；group 缺失的归入「其他」。 */
function groupItems(area: DrillableArea, items: readonly StorageItem[]): readonly ItemGroup[] {
  if (area !== "observations") {
    return items.length > 0 ? [{ key: "all", title: "", items }] : [];
  }
  const groups: ItemGroup[] = [
    { key: "tongue", title: "舌诊", items: items.filter((item) => item.group === "tongue") },
    { key: "face", title: "面诊", items: items.filter((item) => item.group === "face") },
    { key: "other", title: "其他", items: items.filter((item) => item.group !== "tongue" && item.group !== "face") },
  ];
  return groups.filter((group) => group.items.length > 0);
}

export function StorageAreaPage({ runtime, navigate, area }: StorageAreaPageProps) {
  const { show } = useNotification();
  const [items, setItems] = useState<readonly StorageItem[]>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [selectedItem, setSelectedItem] = useState<StorageItem>();
  const [busy, setBusy] = useState(false);

  const valid = isDrillableArea(area);

  const load = useCallback(async () => {
    if (!valid) return;
    setIssue(undefined);
    try {
      setItems(await runtime.storage.listAreaItems(area));
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "STORAGE_READ_FAILED",
        message: "本地存储清单暂时无法读取",
        action: "retry",
      }));
    }
  }, [runtime, area, valid]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!selectedItem || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.storage.deleteItem(selectedItem.id);
      setSelectedItem(undefined);
      setItems(await runtime.storage.listAreaItems(area as DrillableArea));
      show({ level: "success", title: "已删除文件", message: "文件已从本机移除，对应的数据记录仍然保留。" });
    } catch (error) {
      const nextIssue = issueFromAppError(error, {
        code: "STORAGE_WRITE_FAILED",
        message: "定向删除失败，原文件仍然保留",
        action: "retry",
      });
      setIssue(nextIssue);
      setSelectedItem(undefined);
      // 删除句柄只在当前清单快照内有效；清单陈旧（STORAGE_READ_FAILED + retry）时自动重新加载。
      if (nextIssue.code === "STORAGE_READ_FAILED") {
        try {
          setItems(await runtime.storage.listAreaItems(area as DrillableArea));
        } catch {
          // 重新加载也失败时保留原 issue，由 IssueNotice 提供重试。
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => (valid && items ? groupItems(area as DrillableArea, items) : []), [valid, items, area]);

  if (!valid) {
    return (
      <AppShell activeNav="settings" backPath={storageAnalysisPath()} navigate={navigate} subtitle="管理本机存储占用" title="存储管理">
        <ErrorState
          action={<Button onClick={() => navigate(storageAnalysisPath())} variant="quiet">返回存储管理</Button>}
          description="这个存储分区不提供逐项明细，请从存储管理页进入。"
          title="无法打开存储分区"
        />
      </AppShell>
    );
  }

  const title = AREA_TITLES[area];
  const showSkeleton = useSkeletonHold(!items && !issue);
  if (showSkeleton) {
    return (
      <AppShell activeNav="settings" backPath={storageAnalysisPath()} navigate={navigate} subtitle="存储管理" title={title}>
        <PageSkeleton layout="settings" />
      </AppShell>
    );
  }

  const deleteDescription = selectedItem
    ? `只会删除这个文件，对应的任务、报告或制作数据仍然保留。${selectedItem.relativePath ? `位置：应用私有目录/${selectedItem.relativePath}。` : ""}`
    : "";

  return (
    <AppShell activeNav="settings" backPath={storageAnalysisPath()} navigate={navigate} subtitle="存储管理" title={title}>
      <div className="page-stack page-settings storage-analysis">
        {issue ? <IssueNotice actions={{ retry: () => void load() }} issue={issue} /> : null}

        {items && items.length > 0 ? (
          groups.map((group) => (
            <section className="storage-section" key={group.key || "all"} aria-label={group.title || title}>
              {group.title ? (
                <div className="section-heading">
                  <div>
                    <h2>{group.title}</h2>
                  </div>
                </div>
              ) : null}
              <div className="storage-item-list">
                {group.items.map((item) => (
                  <div className="storage-item-row" key={item.id}>
                    <span className="storage-item-row__icon"><Icon name={itemIcon(item)} size={17} /></span>
                    <span className="storage-item-row__body">
                      <strong>{item.label}</strong>
                      <small>
                        {formatByteSize(item.byteLength, "0 B")}
                        {item.relativePath ? ` · ${item.relativePath}` : ""}
                        {item.protectionReason ? ` · ${item.protectionReason}` : ""}
                      </small>
                    </span>
                    {item.deletable ? (
                      <button
                        aria-label={`删除 ${item.label}`}
                        className="storage-item-row__delete"
                        onClick={() => setSelectedItem(item)}
                        type="button"
                      >
                        <Icon name="trash_2" size={17} />
                      </button>
                    ) : (
                      <span className="storage-item-row__status" title={item.protectionReason ?? "保留"}><Icon name="lock" size={15} />保留</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : items ? (
          <EmptyState description="这个分区当前没有任何文件。" icon="folder_open" title="暂时没有文件" />
        ) : null}

        <ConfirmDeleteSheet
          busy={busy}
          confirmLabel="确认删除"
          description={deleteDescription}
          heading={selectedItem ? `删除「${selectedItem.label}」？` : ""}
          onClose={() => { if (!busy) setSelectedItem(undefined); }}
          onConfirm={() => void confirmDelete()}
          open={Boolean(selectedItem)}
          title="确认删除文件"
        />
      </div>
    </AppShell>
  );
}
