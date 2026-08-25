import { useCallback, useEffect, useMemo, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, StorageAnalysisRecord, StorageArea, StorageItem, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { Sheet } from "../components/Sheet";
import { useNotification } from "../notifications/NotificationProvider";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { formatByteSize } from "../runtime/local-cache";

export interface StorageAnalysisPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

const areaLabels: Readonly<Record<StorageArea, string>> = {
  tasks: "拆解任务",
  observations: "观察记录",
  productions: "制作项目",
  templates: "模板数据",
  cache: "缓存与临时文件",
  "app-data": "应用配置",
};

const areaIcons: Readonly<Record<StorageArea, IconName>> = {
  tasks: "video",
  observations: "image",
  productions: "clapperboard",
  templates: "layout_template",
  cache: "trash_2",
  "app-data": "folder",
};

function safePercent(value: number, total: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function itemIcon(item: StorageItem): IconName {
  if (item.kind === "video") return "video";
  if (item.kind === "image") return "image";
  if (item.kind === "document") return "file_text";
  if (item.kind === "temporary") return "trash_2";
  return "folder";
}

function itemAreaLabel(item: StorageItem): string {
  return areaLabels[item.area];
}

export function StorageAnalysisPage({ runtime, navigate }: StorageAnalysisPageProps) {
  const { show } = useNotification();
  const [analysis, setAnalysis] = useState<StorageAnalysisRecord>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [selectedItem, setSelectedItem] = useState<StorageItem>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setIssue(undefined);
    try {
      setAnalysis(await runtime.storage.inspect());
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "STORAGE_READ_FAILED",
        message: "本地存储占用暂时无法读取",
        action: "retry",
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const deletableItems = useMemo(
    () => [...(analysis?.items ?? [])].filter((item) => item.deletable).sort((left, right) => right.byteLength - left.byteLength),
    [analysis],
  );
  const protectedItems = useMemo(
    () => [...(analysis?.items ?? [])].filter((item) => !item.deletable).sort((left, right) => right.byteLength - left.byteLength),
    [analysis],
  );

  const confirmDelete = async () => {
    if (!selectedItem || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      const deletedLabel = selectedItem.label;
      setAnalysis(await runtime.storage.deleteItem(selectedItem.id));
      setSelectedItem(undefined);
      show({ level: "success", title: "已删除媒体文件", message: `${deletedLabel}已从本机移除，数据文件仍然保留。` });
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "STORAGE_WRITE_FAILED",
        message: "定向删除失败，原文件仍然保留",
        action: "retry",
      }));
    } finally {
      setBusy(false);
    }
  };

  const showSkeleton = useSkeletonHold(!analysis && !issue);
  if (showSkeleton) {
    return (
      <AppShell activeNav="settings" backPath="/settings" navigate={navigate} subtitle="查看本机项目占用" title="存储分析">
        <PageSkeleton layout="settings" />
      </AppShell>
    );
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} subtitle="查看本机项目占用" title="存储分析">
      <div className="page-stack page-settings storage-analysis">
        {issue ? <IssueNotice actions={{ retry: () => void load() }} issue={issue} /> : null}

        {analysis ? (
          <>
            <GlassCard className="storage-total-card" tone="soft">
              <div className="storage-total-card__topline">
                <span className="storage-overline">本机应用数据</span>
                <Icon name="folder" size={20} />
              </div>
              <strong>{formatByteSize(analysis.totalByteLength, "未解析到")}</strong>
              <div className="storage-total-card__meta">
                <span><Icon name="trash_2" size={15} />可定向清理 {formatByteSize(analysis.deletableByteLength, "0 B")}</span>
                <span><Icon name="lock" size={15} />数据文件 {formatByteSize(analysis.protectedByteLength, "0 B")}</span>
              </div>
            </GlassCard>

            <aside className="storage-protection-note" role="note">
              <Icon name="lock" size={18} />
              <div>
                <strong>数据文件无法删除</strong>
                <p>任务、拆解文档、观察报告、制作计划和模板数据用于恢复记录，本页只允许定向删除媒体与缓存文件。</p>
              </div>
            </aside>

            <section className="storage-section" aria-labelledby="storage-breakdown-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">真实扫描</span>
                  <h2 id="storage-breakdown-title">占用分布</h2>
                </div>
                <Button aria-label="重新扫描本机存储" onClick={() => void load()} size="md" variant="quiet"><Icon name="sync" size={16} />刷新</Button>
              </div>
              <div className="storage-area-list">
                {analysis.areas.map((area) => (
                  <div className="storage-area-row" key={area.area}>
                    <span className="storage-area-row__icon"><Icon name={areaIcons[area.area]} size={17} /></span>
                    <div className="storage-area-row__body">
                      <div className="storage-area-row__label"><strong>{areaLabels[area.area]}</strong><span>{formatByteSize(area.byteLength, "0 B")}</span></div>
                      <div aria-hidden="true" className="storage-area-row__track"><span style={{ width: `${safePercent(area.byteLength, analysis.totalByteLength)}%` }} /></div>
                      <small>{area.itemCount} 个文件 · 可清理 {formatByteSize(area.deletableByteLength, "0 B")}</small>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="storage-section" aria-labelledby="storage-clean-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">逐项确认</span>
                  <h2 id="storage-clean-title">可定向清理</h2>
                </div>
              </div>
              <p className="storage-section__copy">只删除选中的媒体或临时文件，不会删除对应的任务、报告和制作数据。</p>
              {deletableItems.length > 0 ? (
                <div className="storage-item-list">
                  {deletableItems.map((item) => (
                    <button className="storage-item-row" key={item.id} onClick={() => setSelectedItem(item)} type="button">
                      <span className="storage-item-row__icon"><Icon name={itemIcon(item)} size={17} /></span>
                      <span className="storage-item-row__body"><strong>{item.label}</strong><small>{itemAreaLabel(item)} · {formatByteSize(item.byteLength, "0 B")}</small></span>
                      <Icon className="storage-item-row__action" name="trash_2" size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="storage-empty"><Icon name="circle_check" size={22} /><strong>当前没有可定向清理的媒体</strong><p>扫描到的数据文件会继续保留，确保历史记录可以打开。</p></div>
              )}
            </section>

            <section className="storage-section" aria-labelledby="storage-protected-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">保留项目</span>
                  <h2 id="storage-protected-title">数据文件无法删除</h2>
                </div>
              </div>
              <div className="storage-item-list storage-item-list--protected">
                {protectedItems.length > 0 ? protectedItems.map((item) => (
                  <div className="storage-item-row storage-item-row--protected" key={item.id}>
                    <span className="storage-item-row__icon"><Icon name="lock" size={16} /></span>
                    <span className="storage-item-row__body"><strong>{item.label}</strong><small>{itemAreaLabel(item)} · {formatByteSize(item.byteLength, "0 B")}</small></span>
                    <span className="storage-item-row__status">保留</span>
                  </div>
                )) : <div className="storage-empty"><strong>没有扫描到数据文件</strong></div>}
              </div>
            </section>

            <p className="settings-footnote storage-analysis__footnote">占用来自当前应用私有目录的实际文件大小；扫描时间 {new Date(analysis.generatedAt).toLocaleString()}。Android Keystore 内容不提供可枚举文件大小，也不会被清理。</p>
          </>
        ) : (
          <div className="storage-empty"><Icon name="folder" size={24} /><strong>暂时没有存储快照</strong><Button onClick={() => void load()} variant="quiet">重新读取</Button></div>
        )}

        <Sheet onClose={() => { if (!busy) setSelectedItem(undefined); }} open={Boolean(selectedItem)} title="确认删除媒体">
          {selectedItem ? (
            <div className="storage-delete-confirm">
              <div className="storage-delete-confirm__item"><Icon name={itemIcon(selectedItem)} size={19} /><strong>{selectedItem.label}</strong><span>{formatByteSize(selectedItem.byteLength, "0 B")}</span></div>
              <p>只会删除这个媒体或临时文件。任务、观察报告、制作计划和其他数据文件仍会保留。</p>
              <div className="storage-delete-confirm__actions">
                <Button disabled={busy} onClick={() => setSelectedItem(undefined)} variant="secondary">取消</Button>
                <Button disabled={busy} onClick={() => void confirmDelete()} variant="primary">{busy ? "正在删除" : "确认删除"}</Button>
              </div>
            </div>
          ) : null}
        </Sheet>
      </div>
    </AppShell>
  );
}
