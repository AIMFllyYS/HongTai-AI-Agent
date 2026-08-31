import { useCallback, useEffect, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, StorageAnalysisRecord, StorageArea, TaskIssue } from "@hongtai/core";
import { appDataGroupLabelFor } from "@hongtai/capacitor-runtime";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { Sheet } from "../components/Sheet";
import { TaskMoreActionsSheet } from "../components/TaskMoreActionsSheet";
import { useNotification } from "../notifications/NotificationProvider";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { storageAreaPath } from "../router";
import { formatByteSize } from "../runtime/local-cache";

export interface StorageAnalysisPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

interface AreaMeta {
  readonly label: string;
  readonly subtitle?: string;
  readonly icon: IconName;
}

const AREA_META: Readonly<Record<StorageArea, AreaMeta>> = {
  tasks: { label: "拆解任务", subtitle: "下载的视频与派生媒体", icon: "video" },
  observations: { label: "舌诊面诊", subtitle: "舌诊/面诊照片与观察记录", icon: "scan_face" },
  productions: { label: "制作项目", icon: "clapperboard" },
  templates: { label: "模板数据", icon: "layout_template" },
  cache: { label: "缓存与临时文件", icon: "trash_2" },
  "app-data": { label: "应用配置", icon: "database" },
};

const DRILLABLE_AREAS: readonly StorageArea[] = ["tasks", "observations", "productions", "templates"];

type StorageSheet = "cache" | "app-data";

function safePercent(value: number, total: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

export function StorageAnalysisPage({ runtime, navigate }: StorageAnalysisPageProps) {
  const { show } = useNotification();
  const [analysis, setAnalysis] = useState<StorageAnalysisRecord>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [sheet, setSheet] = useState<StorageSheet>();
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

  const openArea = (area: StorageArea) => {
    if (DRILLABLE_AREAS.includes(area)) navigate(storageAreaPath(area));
    else setSheet(area === "cache" ? "cache" : "app-data");
  };

  const clearCache = async () => {
    if (busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      const { result, analysis: next } = await runtime.storage.clearCache();
      setAnalysis(next);
      show({ level: "success", title: "缓存已清理", message: `已释放 ${formatByteSize(result.freedByteLength, "0 B")}，任务与记录均未受影响。` });
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "STORAGE_WRITE_FAILED",
        message: "缓存清理失败，已保留未删除的文件",
        action: "retry",
      }));
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    if (busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.storage.exportReport();
      show({ level: "success", title: "报告已生成", message: "存储报告已通过系统分享导出。" });
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "STORAGE_WRITE_FAILED",
        message: "存储报告导出失败",
        action: "retry",
      }));
    } finally {
      setBusy(false);
    }
  };

  const showSkeleton = useSkeletonHold(!analysis && !issue);
  if (showSkeleton) {
    return (
      <AppShell activeNav="settings" backPath="/settings" navigate={navigate} subtitle="管理本机存储占用" title="存储管理">
        <PageSkeleton layout="settings" />
      </AppShell>
    );
  }

  const cacheArea = analysis?.areas.find((area) => area.area === "cache");
  const appDataArea = analysis?.areas.find((area) => area.area === "app-data");
  const deviceKnown = Boolean(
    analysis
    && Number.isFinite(analysis.device.totalByteLength)
    && analysis.device.totalByteLength > 0
    && Number.isFinite(analysis.device.freeByteLength),
  );

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} subtitle="管理本机存储占用" title="存储管理">
      <div className="page-stack page-settings storage-analysis">
        {issue ? <IssueNotice actions={{ retry: () => void load() }} issue={issue} /> : null}

        {analysis ? (
          <>
            <GlassCard className="storage-total-card" tone="soft">
              <div className="storage-total-card__topline">
                <span className="storage-overline">本应用占用</span>
                <Icon name="hard_drive" size={20} />
              </div>
              <strong>{formatByteSize(analysis.totalByteLength, "未解析到")}</strong>
              {deviceKnown ? (
                <>
                  <div aria-hidden="true" className="storage-device-track">
                    <span style={{ width: `${safePercent(analysis.totalByteLength, analysis.device.totalByteLength)}%` }} />
                  </div>
                  <p className="storage-total-card__device">
                    设备总容量 {formatByteSize(analysis.device.totalByteLength, "未知")} · 剩余 {formatByteSize(analysis.device.freeByteLength, "未知")}
                  </p>
                </>
              ) : (
                <p className="storage-total-card__device">设备容量暂时无法读取，仅统计应用占用</p>
              )}
            </GlassCard>

            <section className="storage-section" aria-labelledby="storage-breakdown-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">真实扫描</span>
                  <h2 id="storage-breakdown-title">占用分布</h2>
                </div>
                <Button aria-label="重新扫描本机存储" onClick={() => void load()} size="md" variant="quiet"><Icon name="sync" size={16} />刷新</Button>
              </div>
              <div className="storage-area-list">
                {analysis.areas.map((area) => {
                  const meta = AREA_META[area.area];
                  return (
                    <button className="storage-area-row" key={area.area} onClick={() => openArea(area.area)} type="button">
                      <span className="storage-area-row__icon"><Icon name={meta.icon} size={17} /></span>
                      <span className="storage-area-row__body">
                        <span className="storage-area-row__label">
                          <strong><span aria-hidden="true" className={`storage-legend-dot storage-legend-dot--${area.area}`} />{meta.label}</strong>
                          <span>{formatByteSize(area.byteLength, "0 B")}</span>
                        </span>
                        <span aria-hidden="true" className="storage-area-row__track">
                          <span className={`storage-legend-fill storage-legend-fill--${area.area}`} style={{ width: `${safePercent(area.byteLength, analysis.totalByteLength)}%` }} />
                        </span>
                        <small>{meta.subtitle ? `${meta.subtitle} · ` : ""}{area.itemCount} 个文件</small>
                      </span>
                      <Icon className="storage-area-row__chevron" name="chevron_right" size={16} />
                    </button>
                  );
                })}
              </div>
            </section>

            <p className="settings-footnote storage-analysis__footnote">占用来自当前应用私有目录的实际文件大小；扫描时间 {new Date(analysis.generatedAt).toLocaleString()}。Android Keystore 中的密钥不计入占用，也不会被清理。</p>
          </>
        ) : (
          <div className="storage-empty"><Icon name="hard_drive" size={24} /><strong>暂时没有存储快照</strong><Button onClick={() => void load()} variant="quiet">重新读取</Button></div>
        )}

        <TaskMoreActionsSheet
          items={[{
            id: "clear-cache",
            title: `清除缓存（${formatByteSize(cacheArea?.byteLength, "0 B")}）`,
            description: "只清理临时与缓存文件，任务、观察记录和制作数据都会保留。",
            icon: "trash_2",
            onSelect: () => void clearCache(),
          }]}
          onClose={() => { if (!busy) setSheet(undefined); }}
          open={sheet === "cache"}
        />

        <Sheet onClose={() => { if (!busy) setSheet(undefined); }} open={sheet === "app-data"} title="应用配置">
          <p className="settings-sheet-copy">系统与配置文件用于应用运行，无法清理。</p>
          {analysis && analysis.appDataGroups.length > 0 ? (
            <div className="storage-group-list">
              {analysis.appDataGroups.map((group) => (
                <div className="storage-group-row" key={group.key}>
                  <div className="storage-group-row__label">
                    <strong>{appDataGroupLabelFor(group.key)}</strong>
                    <span>{formatByteSize(group.byteLength, "0 B")}</span>
                  </div>
                  <div aria-hidden="true" className="storage-area-row__track">
                    <span style={{ width: `${safePercent(group.byteLength, appDataArea?.byteLength ?? 0)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-sheet-copy">未提供分组明细，共 {formatByteSize(appDataArea?.byteLength, "0 B")}。</p>
          )}
          <Button disabled={busy} onClick={() => void exportReport()} variant="primary"><Icon name="share_2" size={16} />{busy ? "正在导出" : "导出报告"}</Button>
          <Button className="sheet-cancel" disabled={busy} onClick={() => setSheet(undefined)} variant="quiet">取消</Button>
        </Sheet>
      </div>
    </AppShell>
  );
}
