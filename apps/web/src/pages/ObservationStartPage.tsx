import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, DiagnosisSessionRecord, MediaReference, ObservationMode, StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { diagnosisModuleDefinitions } from "../features/diagnosis/diagnosis-module-progress";
import { observationModeLabel } from "../features/diagnosis/diagnosis-presenters";
import { LiveListReadReconciler } from "../features/generation/live-list-read-reconciler";
import { useAppResume } from "../hooks/useAppResume";
import { observationReportPath, type Navigate } from "../router";

export interface ObservationStartPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

const modes: readonly { readonly id: ObservationMode; readonly title: string; readonly description: string; readonly icon: "face" | "visibility" }[] = [
  { id: "tongue", title: "舌象观察", description: "请在自然光下拍摄舌面，并只用于本次本地观察。", icon: "visibility" },
  { id: "face", title: "面部观察", description: "请在自然光下正面拍摄面部，并只用于本次本地观察。", icon: "face" },
];

/** Native capture is declared by AppRuntime and always imports into private storage first. */
export const OBSERVATION_CAPTURE_IMAGE_SLOT = {
  capability: "diagnosis.captureImage",
  render: true,
} as const;

function statusLabel(session: DiagnosisSessionRecord): string {
  if (session.reportStatus === "pending") return "等待生成报告";
  if (session.reportStatus === "running") return "正在生成报告";
  if (session.reportStatus === "succeeded") return "报告已保存";
  return "报告未完成";
}

function statusIcon(session: DiagnosisSessionRecord): "pending" | "sync" | "check_circle" | "error" {
  if (session.reportStatus === "pending") return "pending";
  if (session.reportStatus === "running") return "sync";
  if (session.reportStatus === "succeeded") return "check_circle";
  return "error";
}

export function upsertObservationSession(
  current: readonly DiagnosisSessionRecord[] | undefined,
  session: DiagnosisSessionRecord,
): readonly DiagnosisSessionRecord[] {
  const byId = new Map((current ?? []).map((item) => [item.sessionId, item]));
  byId.set(session.sessionId, session);
  return [...byId.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function ObservationStartPage({ runtime, navigate }: ObservationStartPageProps) {
  const diagnosisAvailable = runtime.features.diagnosis === "available";
  const observationHistoryReads = useRef(new LiveListReadReconciler<DiagnosisSessionRecord>());
  const [mode, setMode] = useState<ObservationMode>("tongue");
  const [image, setImage] = useState<MediaReference>();
  const [sessions, setSessions] = useState<readonly DiagnosisSessionRecord[]>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [historyIssue, setHistoryIssue] = useState<TaskIssue>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(true);
  const [reportProgress, setReportProgress] = useState<StructuredGenerationProgressV1>();

  const applySessionChange = useCallback((session: DiagnosisSessionRecord) => {
    observationHistoryReads.current.record(session);
    setSessions((current) => upsertObservationSession(current, session));
  }, []);

  const loadSessions = useCallback(async () => {
    const read = observationHistoryReads.current.beginRead();
    try {
      const loaded = await runtime.diagnosis.listSessions();
      const reconciled = observationHistoryReads.current.reconcile(
        read,
        loaded,
        (current, session) => upsertObservationSession(current, session),
      );
      if (reconciled === undefined) return;
      setSessions(reconciled);
      setHistoryIssue(undefined);
    } catch (error) {
      if (!observationHistoryReads.current.abandon(read)) return;
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地观察历史暂时无法读取", action: "none" }));
    }
  }, [runtime]);

  useAppResume(loadSessions);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const running = sessions?.filter((session) => session.reportStatus === "running") ?? [];
    const subscriptions: Array<() => void> = [];
    try {
      for (const session of running) {
        subscriptions.push(runtime.diagnosis.subscribeReport(session.sessionId, (event) => {
          if (event.type === "completed") {
            applySessionChange({ ...session, reportStatus: "succeeded", updatedAt: event.record.updatedAt });
          }
          if (event.type === "failed") {
            void runtime.diagnosis.getSession(session.sessionId).then((stored) => {
              if (stored) applySessionChange(stored);
            }).catch(() => undefined);
          }
        }));
      }
    } catch (error) {
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "观察历史自动更新暂时不可用", action: "none" }));
    }
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [applySessionChange, runtime, sessions]);

  useEffect(() => {
    let active = true;
    const consumeRecovery = async () => {
      try {
        const recovered = await runtime.diagnosis.consumeImageRecovery();
        if (!active) return;
        if (recovered.status === "succeeded") setImage(recovered.image);
        if (recovered.status === "failed") setIssue(recovered.issue);
      } catch (error) {
        if (active) {
          setIssue(issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "图片操作恢复失败，请重新选择或拍摄", action: "select_media" }));
        }
      } finally {
        if (active) setImporting(false);
      }
    };
    void consumeRecovery();
    return () => { active = false; };
  }, [runtime]);

  const chooseMode = (nextMode: ObservationMode) => {
    setMode(nextMode);
    setImage(undefined);
    setIssue(undefined);
  };

  const pickImage = async () => {
    if (!diagnosisAvailable || loading || importing) return;
    setImporting(true);
    setIssue(undefined);
    try {
      setImage(await runtime.diagnosis.pickImage());
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "无法将图片安全导入本地私有目录", action: "select_media" }));
    } finally {
      setImporting(false);
    }
  };

  const captureImage = async () => {
    if (!diagnosisAvailable || loading || importing) return;
    setImporting(true);
    setIssue(undefined);
    try {
      setImage(await runtime.diagnosis.captureImage());
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "无法将拍摄图片安全导入本地私有目录", action: "select_media" }));
    } finally {
      setImporting(false);
    }
  };

  const createReport = async () => {
    if (!diagnosisAvailable || !image || loading || importing) return;
    setLoading(true);
    setIssue(undefined);
    setReportProgress(undefined);
    try {
      const session = await runtime.diagnosis.createSession({ mode, image });
      applySessionChange(session);
      applySessionChange({ ...session, reportStatus: "running" });
      try {
        await runtime.diagnosis.runReport(session.sessionId, (event) => {
          if (event.type === "progress") setReportProgress(event.progress);
          if (event.type === "failed") {
            setReportProgress(event.progress);
            setIssue(event.issue);
            void runtime.diagnosis.getSession(session.sessionId).then((stored) => {
              if (stored) applySessionChange(stored);
            }).catch(() => undefined);
          }
          if (event.type === "completed") {
            applySessionChange({ ...session, reportStatus: "succeeded", updatedAt: event.record.updatedAt });
          }
        });
        navigate(observationReportPath(session.sessionId));
      } catch (error) {
        // Navigate only when native storage has a terminal projection. If a
        // storage failure prevented the failed state from being committed, a
        // report page must not present that stale running row as live work.
        const stored = await runtime.diagnosis.getReport(session.sessionId).catch(() => undefined);
        if (stored?.status === "succeeded" || stored?.status === "failed") {
          const storedSession = await runtime.diagnosis.getSession(session.sessionId).catch(() => undefined);
          if (storedSession) applySessionChange(storedSession);
          navigate(observationReportPath(session.sessionId));
        } else {
          setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "观察报告状态无法安全保存，请释放空间后重试。", action: "free_storage" }));
        }
      }
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法创建本地观察会话", action: "free_storage" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell activeNav="ai" navigate={navigate} title="舌象与面部观察" visualTheme="warm-soft-tech">
      <div className="page-stack page-observation-start">
        <section className="observation-heading">
          <span className="eyebrow">LOCAL OBSERVATION</span>
          <h2>选择一种观察方式</h2>
          <p>每个会话只能选择舌象或面部其中一种图片。结果只提供日常参考，不替代专业意见。</p>
        </section>

        {!diagnosisAvailable ? <GlassCard className="observation-capability-notice" data-feature-capability="planned" tone="soft"><Icon name="pending" size={22} /><div><span>尚未接入</span><strong>本地图片观察与报告正在准备中</strong><p>当前版本不会把示例图片或示例报告伪装为你的真实结果。</p></div></GlassCard> : null}
        {issue ? <IssueNotice actions={{ selectMedia: () => void pickImage() }} issue={issue} /> : null}

        <section aria-label="选择观察方式" className="observation-mode-grid">
          {modes.map((item) => (
            <button aria-pressed={mode === item.id} className={`observation-mode-card ${mode === item.id ? "is-selected" : ""}`.trim()} disabled={loading || importing} key={item.id} onClick={() => chooseMode(item.id)} type="button">
              <span><Icon name={item.icon} size={28} /></span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
              {mode === item.id ? <i aria-label="已选择"><Icon name="check_circle" size={18} /></i> : null}
            </button>
          ))}
        </section>

        <GlassCard className="observation-capture-card">
          <div className="observation-capture-card__copy"><span className="eyebrow">STEP 2</span><h3>{observationModeLabel(mode)}图片</h3><p>{mode === "tongue" ? "尽量保持舌面清晰、避免滤镜和强色光。" : "尽量保持正面、自然光和无遮挡。"}</p></div>
          {importing ? <div aria-live="polite" className="observation-capture-card__empty" role="status"><Icon name="sync" size={30} /><span>正在导入图片</span></div> : image ? <RuntimeMediaFrame className="observation-capture-card__image" label={`${observationModeLabel(mode)}图片`} media={image} /> : <div className="observation-capture-card__empty"><Icon name="camera" size={30} /><span>尚未选择图片</span></div>}
          <div className="observation-capture-card__actions mobile-action-group"><Button disabled={!diagnosisAvailable || loading || importing} icon={<Icon name="camera" size={18} />} onClick={() => void captureImage()} variant="secondary">拍摄图片</Button><Button disabled={!diagnosisAvailable || loading || importing} icon={<Icon name="upload_file" size={18} />} onClick={() => void pickImage()} variant="secondary">选择图片</Button><Button disabled={!diagnosisAvailable || !image || loading || importing} icon={<Icon name="auto_awesome" size={18} />} onClick={() => void createReport()}>{loading ? "正在生成五个板块" : "生成观察报告"}</Button></div>
          {loading || reportProgress ? <ValidatedModuleProgress definitions={diagnosisModuleDefinitions} failedTitle="观察报告未完成" issue={issue} progress={reportProgress} title="正在生成真实观察报告" /> : null}
          <small className="observation-privacy-note"><Icon name="folder_special" size={15} />图片会复制到应用私有目录；不会作为公开素材或自动发布内容。</small>
        </GlassCard>

        <section className="page-section">
          <div className="section-heading"><div><span className="eyebrow">LOCAL HISTORY</span><h3>本地观察历史</h3></div>{historyIssue ? <Button onClick={() => void loadSessions()} variant="quiet">重新读取</Button> : null}</div>
          {historyIssue ? <IssueNotice issue={historyIssue} /> : null}
          {sessions === undefined ? <LoadingState description="正在读取本地会话投影" title="读取观察历史" /> : sessions.length === 0 ? <EmptyState description="完成一次真实图片观察后，会话和正式报告会保存在本地这里。" icon="history" title="尚无本地观察" /> : <div className="observation-history-list">{sessions.map((session) => <button className="observation-history-item" key={session.sessionId} onClick={() => navigate(observationReportPath(session.sessionId))} type="button"><span className={`observation-history-item__icon is-${session.reportStatus}`}><Icon name={statusIcon(session)} size={20} /></span><span><strong>{observationModeLabel(session.mode)}</strong><small>{statusLabel(session)}</small></span><Icon name="chevron_right" size={18} /></button>)}</div>}
        </section>
      </div>
    </AppShell>
  );
}
