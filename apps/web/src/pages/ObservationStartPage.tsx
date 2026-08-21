import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, DiagnosisSessionRecord, MediaReference, ObservationMode, StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { HomeMastheadActions } from "../components/HomeMastheadActions";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { Tabs } from "../components/Tabs";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { diagnosisModuleDefinitions } from "../features/diagnosis/diagnosis-module-progress";
import { OBSERVATION_REPORT_DISCLAIMER_FALLBACK } from "../features/diagnosis/diagnosis-presenters";
import {
  ObservationCapturePanel,
  ObservationHistoryCard,
  ObservationPhotoConfirmSheet,
  type ObservationImageSource,
} from "../features/diagnosis/observation-start-panels";
import { LiveListReadReconciler } from "../features/generation/live-list-read-reconciler";
import { useAppResume } from "../hooks/useAppResume";
import { observationReportPath, type Navigate } from "../router";

export interface ObservationStartPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

const modes: readonly { readonly id: ObservationMode; readonly title: string }[] = [
  { id: "face", title: "面部观察" },
  { id: "tongue", title: "舌象观察" },
];

/** Native capture is declared by AppRuntime and always imports into private storage first. */
export const OBSERVATION_CAPTURE_IMAGE_SLOT = {
  capability: "diagnosis.captureImage",
  render: true,
} as const;

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
  const runningReportSubscriptions = useRef(new Map<string, () => void>());
  const [mode, setMode] = useState<ObservationMode>("face");
  const [image, setImage] = useState<MediaReference>();
  const [imageSource, setImageSource] = useState<ObservationImageSource>("album");
  const [sessions, setSessions] = useState<readonly DiagnosisSessionRecord[]>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [historyIssue, setHistoryIssue] = useState<TaskIssue>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportProgress, setReportProgress] = useState<StructuredGenerationProgressV1>();

  const applySessionChange = useCallback((session: DiagnosisSessionRecord) => {
    observationHistoryReads.current.record(session);
    setSessions((current) => upsertObservationSession(current, session));
  }, []);

  const applySessionTerminal = useCallback((sessionId: string, patch: Pick<DiagnosisSessionRecord, "reportStatus" | "updatedAt">) => {
    setSessions((current) => {
      const existing = current?.find((item) => item.sessionId === sessionId);
      if (!existing) return current;
      const next = { ...existing, ...patch };
      observationHistoryReads.current.record(next);
      return upsertObservationSession(current, next);
    });
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

  const runningSessionKey = (sessions ?? [])
    .filter((session) => session.reportStatus === "running")
    .map((session) => session.sessionId)
    .sort()
    .join("\n");

  useEffect(() => {
    const wantedIds = new Set(runningSessionKey === "" ? [] : runningSessionKey.split("\n"));
    const subscriptions = runningReportSubscriptions.current;
    for (const [sessionId, unsubscribe] of [...subscriptions]) {
      if (wantedIds.has(sessionId)) continue;
      unsubscribe();
      subscriptions.delete(sessionId);
    }
    try {
      for (const sessionId of wantedIds) {
        if (subscriptions.has(sessionId)) continue;
        subscriptions.set(sessionId, runtime.diagnosis.subscribeReport(sessionId, (event) => {
          if (event.type === "completed") {
            applySessionTerminal(sessionId, { reportStatus: "succeeded", updatedAt: event.record.updatedAt });
          }
          if (event.type === "failed") {
            void runtime.diagnosis.getSession(sessionId).then((stored) => {
              if (stored) applySessionChange(stored);
            }).catch(() => undefined);
          }
        }));
      }
    } catch (error) {
      setHistoryIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "观察历史自动更新暂时不可用", action: "none" }));
    }
  }, [applySessionChange, applySessionTerminal, runtime, runningSessionKey]);

  useEffect(() => {
    const subscriptions = runningReportSubscriptions.current;
    return () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    };
  }, [runtime]);

  useEffect(() => {
    let active = true;
    const consumeRecovery = async () => {
      try {
        const recovered = await runtime.diagnosis.consumeImageRecovery();
        if (!active) return;
        if (recovered.status === "succeeded") {
          setImage(recovered.image);
          setImageSource("recovery");
          setConfirmOpen(true);
        }
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
    if (loading || importing) return;
    setMode(nextMode);
    setImage(undefined);
    setIssue(undefined);
    setConfirmOpen(false);
  };

  const pickImage = async () => {
    if (!diagnosisAvailable || loading || importing) return;
    setConfirmOpen(false);
    setImporting(true);
    setIssue(undefined);
    try {
      setImage(await runtime.diagnosis.pickImage());
      setImageSource("album");
      setConfirmOpen(true);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "图片没有保存成功，请重新选择", action: "select_media" }));
    } finally {
      setImporting(false);
    }
  };

  const captureImage = async () => {
    if (!diagnosisAvailable || loading || importing) return;
    setConfirmOpen(false);
    setImporting(true);
    setIssue(undefined);
    try {
      setImage(await runtime.diagnosis.captureImage());
      setImageSource("camera");
      setConfirmOpen(true);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "拍摄的图片没有保存成功，请重新拍摄", action: "select_media" }));
    } finally {
      setImporting(false);
    }
  };

  const createReport = async () => {
    if (!diagnosisAvailable || !image || loading || importing) return;
    setConfirmOpen(false);
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
            applySessionTerminal(session.sessionId, { reportStatus: "succeeded", updatedAt: event.record.updatedAt });
          }
        });
        navigate(observationReportPath(session.sessionId));
      } catch (error) {
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
    <AppShell activeNav="ai" headerAction={<HomeMastheadActions navigate={navigate} runtime={runtime} />} navigate={navigate} subtitle="舌象或面部，结果仅供日常参考" title="AI 智能诊断" visualTheme="warm-soft-tech">
      <div className="page-stack page-observation-start">
        {!diagnosisAvailable ? <GlassCard className="observation-capability-notice" data-feature-capability="planned" tone="soft"><Icon name="pending" size={22} /><div><span>尚未接入</span><strong>本地图片观察与报告正在准备中</strong><p>当前版本不会把示例图片或示例报告伪装为你的真实结果。</p></div></GlassCard> : null}
        {issue ? <IssueNotice actions={{ selectMedia: () => void pickImage() }} issue={issue} /> : null}

        <Tabs
          active={modes.find((item) => item.id === mode)?.title ?? "面部观察"}
          ariaLabel="选择观察方式"
          id="observation-mode"
          onSelect={(tab) => {
            const next = modes.find((item) => item.title === tab);
            if (next) chooseMode(next.id);
          }}
          tabs={modes.map((item) => item.title)}
          variant="segmented"
        />

        <ObservationCapturePanel
          busy={loading}
          diagnosisAvailable={diagnosisAvailable}
          image={image}
          importing={importing}
          mode={mode}
          onCapture={() => void captureImage()}
          onPick={() => void pickImage()}
          onScan={() => void pickImage()}
        />

        {loading || reportProgress ? <ValidatedModuleProgress definitions={diagnosisModuleDefinitions} failedTitle="观察报告未完成" issue={issue} progress={reportProgress} title="正在生成真实观察报告" /> : null}
        <small className="observation-privacy-note">图片只保存在本机，不会上传或公开</small>
        <p className="observation-disclaimer observation-disclaimer--foot">{OBSERVATION_REPORT_DISCLAIMER_FALLBACK}</p>

        <ObservationPhotoConfirmSheet
          confirming={loading}
          diagnosisAvailable={diagnosisAvailable}
          image={image}
          importing={importing}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => void createReport()}
          onReselect={() => {
            setConfirmOpen(false);
            setImage(undefined);
          }}
          open={confirmOpen}
          source={imageSource}
        />

        <section className="page-section">
          <div className="section-heading"><div><h3>最近观察</h3></div>{historyIssue ? <Button onClick={() => void loadSessions()} variant="quiet">重新读取</Button> : null}</div>
          {historyIssue ? <IssueNotice issue={historyIssue} /> : null}
          {sessions === undefined ? <PageSkeleton layout="observation-list" /> : sessions.length === 0 ? <EmptyState description="完成一次真实图片观察后，会话和正式报告会保存在本地这里。" icon="history" title="尚无本地观察" /> : <div className="observation-history-list">{sessions.map((session) => <ObservationHistoryCard key={session.sessionId} onOpen={() => navigate(observationReportPath(session.sessionId))} session={session} />)}</div>}
        </section>
      </div>
    </AppShell>
  );
}
