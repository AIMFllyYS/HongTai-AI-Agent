import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, DiagnosisMessage, DiagnosisReportRecord, DiagnosisSessionRecord, LocalProfile, StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { EmptyState, ErrorState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import {
  OBSERVATION_FOLLOW_UP_PAGE_INPUT_ID,
  ObservationFollowUpComposer,
} from "../features/diagnosis/observation-follow-up-composer";
import { ObservationFollowUpSheet } from "../features/diagnosis/observation-follow-up-sheet";
import {
  imageQualityBadgeLabel,
  imageQualityDescription,
  observationBasisCaption,
  observationCategoryLabel,
  observationEvidenceText,
  observationModeLabel,
  observationReportDisclaimer,
  observationReportHeroTitle,
  observationReportMetaLine,
  observationReportStateLabel,
  readDiagnosisReport,
  recommendationPriorityLabel,
  referenceCertaintyLabel,
  safetyLevelChipLabel,
  visibilityLabel,
  type DiagnosisReportView,
} from "../features/diagnosis/diagnosis-presenters";
import {
  isObservationObservingView,
  ObservationObservingScreen,
} from "../features/diagnosis/observation-observing-screen";
import { useAppResume } from "../hooks/useAppResume";
import { observationNewPath, type Navigate } from "../router";
import { observationReportSections } from "../playbook/document-sections";

export interface ObservationReportPageProps {
  readonly runtime: AppRuntime;
  readonly sessionId: string;
  readonly navigate: Navigate;
}

function reportStatusTitle(record: DiagnosisReportRecord | undefined): string {
  if (!record || record.status === "pending") return "等待生成报告";
  if (record.status === "running") return "正在生成报告";
  if (record.status === "failed") return "报告未完成";
  return "已保存观察报告";
}

function ReportSection({
  icon,
  title,
  extra,
  children,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly extra?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="observation-report-block">
      <div className="observation-report-sec">
        <div className="observation-report-sec__left">
          <Icon name={icon} size={18} />
          <h3>{title}</h3>
        </div>
        {extra ? <span className="observation-report-sec__extra">{extra}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ObservationReportPage({ runtime, sessionId, navigate }: ObservationReportPageProps) {
  const diagnosisAvailable = runtime.features.diagnosis === "available";
  const [session, setSession] = useState<DiagnosisSessionRecord>();
  const [record, setRecord] = useState<DiagnosisReportRecord>();
  const [messages, setMessages] = useState<readonly DiagnosisMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [reportProgress, setReportProgress] = useState<StructuredGenerationProgressV1>();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<string>();
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [profile, setProfile] = useState<LocalProfile>();

  const load = useCallback(async () => {
    try {
      const [nextSession, nextRecord, nextMessages] = await Promise.all([
        runtime.diagnosis.getSession(sessionId),
        runtime.diagnosis.getReport(sessionId),
        runtime.diagnosis.listMessages(sessionId),
      ]);
      setSession(nextSession);
      setRecord(nextRecord);
      setMessages(nextMessages);
      setReadIssue(undefined);
    } catch (error) {
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地观察报告暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId]);

  useAppResume(load);

  useEffect(() => {
    let cancelled = false;
    void runtime.profile.get().then((next) => {
      if (!cancelled) setProfile(next);
    }).catch(() => {
      if (!cancelled) setProfile(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  useEffect(() => {
    void load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = runtime.diagnosis.subscribeReport(sessionId, (event) => {
        if (event.type === "progress") setReportProgress(event.progress);
        if (event.type === "failed") {
          setReportProgress(event.progress);
          setIssue(event.issue);
          void load();
        }
        if (event.type === "completed") {
          setRecord(event.record);
          setReportProgress(undefined);
          setIssue(undefined);
          void load();
        }
      });
    } catch (error) {
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "观察报告自动更新暂时不可用", action: "none" }));
    }
    return () => unsubscribe?.();
  }, [load, runtime, sessionId]);

  const report = useMemo(() => record ? readDiagnosisReport(record) : undefined, [record]);
  const reportRunLock = useRef(false);
  const autoStartedFor = useRef<string | undefined>(undefined);

  const runReport = useCallback(async () => {
    if (!diagnosisAvailable || reportRunLock.current) return;
    reportRunLock.current = true;
    setIssue(undefined);
    try {
      const next = await runtime.diagnosis.runReport(sessionId);
      setRecord(next);
      await load();
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "观察报告未能完成", action: "configure_ai" }));
      await load();
    } finally {
      reportRunLock.current = false;
    }
  }, [diagnosisAvailable, load, runtime, sessionId]);

  useEffect(() => {
    autoStartedFor.current = undefined;
  }, [sessionId]);

  useEffect(() => {
    if (loading || !session || !diagnosisAvailable) return;
    if (record?.status === "succeeded" || record?.status === "failed") return;
    if (autoStartedFor.current === sessionId) return;
    autoStartedFor.current = sessionId;
    void runReport();
  }, [diagnosisAvailable, loading, record?.status, runReport, session, sessionId]);

  const askQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!diagnosisAvailable || !trimmed || chatPending) return;
    setFollowUpOpen(true);
    setChatPending(true);
    setIssue(undefined);
    setFailedQuestion(undefined);
    setPendingQuestion(trimmed);
    setStreamedAnswer("");
    setQuestion("");
    try {
      await runtime.diagnosis.followUp(sessionId, trimmed, async (event) => {
        if (event.type === "content_delta") {
          setStreamedAnswer((current) => `${current}${event.delta}`);
        }
        if (event.type === "failed") setIssue(event.issue);
      });
      setPendingQuestion(undefined);
      setStreamedAnswer("");
      await load();
    } catch (error) {
      setPendingQuestion(undefined);
      setStreamedAnswer("");
      setQuestion(trimmed);
      setFailedQuestion(trimmed);
      setIssue(issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "追问没有完成", action: "retry" }));
    } finally {
      setChatPending(false);
    }
  };

  const ask = async () => askQuestion(question);

  const useQuestion = (value: string) => {
    void askQuestion(value);
  };

  const openFollowUpIfHistory = () => {
    if (messages.length > 0 || pendingQuestion) setFollowUpOpen(true);
  };

  const showSkeleton = useSkeletonHold(loading);
  if (showSkeleton) {
    return <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title="观察报告" visualTheme="warm-soft-tech"><PageSkeleton layout="report" /></AppShell>;
  }
  if (!session) {
    const unavailableIssue = readIssue ?? issue;
    return <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title="观察报告" visualTheme="warm-soft-tech"><ErrorState action={<Button onClick={() => navigate(observationNewPath())} variant="secondary">新建观察</Button>} description={unavailableIssue?.userMessage ?? "该本地观察会话不存在，或无法安全读取。"} title="找不到观察会话" /></AppShell>;
  }

  const canShowReport = report?.available === true;
  const reportIssue = readIssue ?? issue ?? record?.issue;
  const reportRetryAllowed = record?.status === "failed" && reportIssue?.action === "retry" && diagnosisAvailable;
  const disclaimer = observationReportDisclaimer(report);
  const issueActions = {
    configureAi: () => navigate("/settings/ai"),
    selectMedia: () => navigate(observationNewPath()),
    retry: failedQuestion
      ? () => void askQuestion(failedQuestion)
      : reportRetryAllowed ? () => void runReport() : undefined,
    editInput: () => setFollowUpOpen(true),
  };

  if (isObservationObservingView(record?.status, canShowReport)) {
    return (
      <AppShell
        activeNav="ai"
        backPath={observationNewPath()}
        headerMode="detail"
        navigate={navigate}
        showNav={false}
        title="AI 正在观察"
        visualTheme="warm-soft-tech"
      >
        <ObservationObservingScreen
          diagnosisAvailable={diagnosisAvailable}
          issue={reportIssue}
          issueActions={issueActions}
          onCancel={() => navigate(observationNewPath())}
          progress={reportProgress}
          session={session}
        />
      </AppShell>
    );
  }

  const displayName = profile?.displayName?.trim();
  const displayInitial = displayName ? Array.from(displayName)[0] : undefined;

  return (
    <AppShell
      activeNav="ai"
      backPath={observationNewPath()}
      headerMode="detail"
      navigate={navigate}
      showNav={false}
      title="观察报告"
      visualTheme="warm-soft-tech"
    >
      <div className="page-stack page-observation-report">
        <aside className="observation-report-banner">{disclaimer}</aside>

        <section className="observation-report-hero">
          <h2>{canShowReport && report ? observationReportHeroTitle(report) : reportStatusTitle(record)}</h2>
          <div className="observation-report-meta">
            <p>{observationReportMetaLine({ mode: session.mode, timestamp: record?.updatedAt ?? session.updatedAt })}</p>
            <span className={`observation-report-state is-${record?.status ?? "pending"}`}>{observationReportStateLabel(record?.status, canShowReport)}</span>
          </div>
        </section>

        {reportIssue ? <IssueNotice actions={issueActions} issue={reportIssue} /> : null}

        {record?.status === "succeeded" && !canShowReport ? <ErrorState description="这份报告内容不完整，应用不会自行猜测或补写。请重新生成报告。" title="报告暂时无法展示" /> : null}

        {canShowReport && report ? <SucceededReport
          avatarUri={profile?.avatarUri}
          chatPending={chatPending}
          diagnosisAvailable={diagnosisAvailable}
          disclaimer={disclaimer}
          displayInitial={displayInitial}
          followUpOpen={followUpOpen}
          messages={messages}
          onAsk={() => void ask()}
          onCloseFollowUp={() => setFollowUpOpen(false)}
          onFocusComposer={openFollowUpIfHistory}
          onQuestionChange={setQuestion}
          onUseQuestion={useQuestion}
          pendingQuestion={pendingQuestion}
          question={question}
          report={report}
          session={session}
          streamedAnswer={streamedAnswer}
        /> : null}
      </div>
    </AppShell>
  );
}

function SucceededReport({
  avatarUri,
  chatPending,
  diagnosisAvailable,
  disclaimer,
  displayInitial,
  followUpOpen,
  messages,
  onAsk,
  onCloseFollowUp,
  onFocusComposer,
  onQuestionChange,
  onUseQuestion,
  pendingQuestion,
  question,
  report,
  session,
  streamedAnswer,
}: {
  readonly avatarUri: string | null | undefined;
  readonly chatPending: boolean;
  readonly diagnosisAvailable: boolean;
  readonly disclaimer: string;
  readonly displayInitial: string | undefined;
  readonly followUpOpen: boolean;
  readonly messages: readonly DiagnosisMessage[];
  readonly onAsk: () => void;
  readonly onCloseFollowUp: () => void;
  readonly onFocusComposer: () => void;
  readonly onQuestionChange: (value: string) => void;
  readonly onUseQuestion: (value: string) => void;
  readonly pendingQuestion: string | undefined;
  readonly question: string;
  readonly report: DiagnosisReportView;
  readonly session: DiagnosisSessionRecord;
  readonly streamedAnswer: string;
}) {
  const qualityNote = imageQualityDescription(report.imageQuality);
  return (
    <>
      <GlassCard className={`observation-quality-card is-${report.imageQuality?.overallQuality ?? "limited"}`}>
        <RuntimeMediaFrame className="observation-quality-card__thumb" label={`${observationModeLabel(session.mode)}原图`} media={session.image} />
        <div>
          <div className="observation-quality-card__top">
            <strong>图像质量</strong>
            <small>{report.imageQuality ? imageQualityBadgeLabel(report.imageQuality.overallQuality) : "状态未知"}</small>
          </div>
          {qualityNote ? <p>{qualityNote}</p> : null}
        </div>
      </GlassCard>

      <ReportSection icon={observationReportSections.summary.icon} title={observationReportSections.summary.title}>
        {report.summary?.keyPoints.length ? (
          <ul className="observation-report-bullets">
            {report.summary.keyPoints.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
        {report.summary?.narrative ? <p className="observation-report-narrative">{report.summary.narrative}</p> : null}
      </ReportSection>

      <ReportSection extra={`${report.observations.length} 项`} icon={observationReportSections.details.icon} title={observationReportSections.details.title}>
        {report.observations.length ? (
          <div className="observation-report-list">
            {report.observations.map((item) => {
              const evidence = observationEvidenceText(item);
              return (
                <GlassCard className="observation-report-item" key={item.id}>
                  <div className="observation-report-item__title">
                    <div className="observation-report-item__heading">
                      <span className="observation-report-item__category">{observationCategoryLabel(item.category)}</span>
                      <strong>{item.label}</strong>
                    </div>
                    <small className={`is-${item.visibility}`}>{visibilityLabel(item.visibility)}</small>
                  </div>
                  <p className="observation-report-item__region">区域 · {item.region}</p>
                  <p>{item.description}</p>
                  {evidence ? <em>{evidence}</em> : null}
                </GlassCard>
              );
            })}
          </div>
        ) : <EmptyState description="该报告没有可安全展示的观察项。" icon="eye" title="暂无可见观察" />}
      </ReportSection>

      <ReportSection extra="非诊断 · 不确定" icon={observationReportSections.references.icon} title={observationReportSections.references.title}>
        {report.wellnessReferences.length ? (
          <div className="observation-reference-list">
            {report.wellnessReferences.map((item) => {
              const basis = observationBasisCaption(item.basisObservationIds, report.observations);
              return (
                <GlassCard className="observation-reference-card" key={item.title}>
                  <strong>{item.title}</strong>
                  <p>{item.statement}</p>
                  <div className="observation-reference-card__meta">
                    <small>{referenceCertaintyLabel(item.certainty)}</small>
                    {basis ? <span>{basis}</span> : null}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        ) : <EmptyState description="没有可基于当前图片提供的日常参考。" icon="book_open" title="暂无日常参考" />}
      </ReportSection>

      <GlassCard className="observation-recommendation-panel">
        <div className="observation-report-sec">
          <div className="observation-report-sec__left">
            <Icon name={observationReportSections.recommendations.icon} size={18} />
            <h3>{observationReportSections.recommendations.title}</h3>
          </div>
        </div>
        {report.recommendations.length ? (
          <div className="observation-recommendation-list">
            {report.recommendations.map((item) => {
              const priority = recommendationPriorityLabel(item.priority);
              return (
                <article className="observation-recommendation-card" key={item.title}>
                  <div className="observation-recommendation-card__top">
                    <strong>{item.title}</strong>
                    {priority ? <span className={`observation-recommendation-card__priority is-${item.priority}`}>{priority}</span> : null}
                  </div>
                  <p>{item.action}</p>
                </article>
              );
            })}
          </div>
        ) : <p className="observation-report-narrative">这次没有可安全展示的日常建议。</p>}
      </GlassCard>

      {report.safetyGuidance ? (
        <GlassCard className={`observation-safety-card is-${report.safetyGuidance.level}`}>
          <Icon name={report.safetyGuidance.level === "urgent" ? "shield_alert" : observationReportSections.safety.icon} size={22} />
          <div>
            <div className="observation-safety-card__top">
              <strong>{observationReportSections.safety.title}</strong>
              <small>{safetyLevelChipLabel(report.safetyGuidance.level)}</small>
            </div>
            <p>{report.safetyGuidance.recommendedAction}</p>
            {report.safetyGuidance.reasons.length ? <ul>{report.safetyGuidance.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
          </div>
        </GlassCard>
      ) : null}

      <section className="observation-report-limits">
        <h3>本次观察的局限</h3>
        <ul className="observation-report-bullets observation-report-bullets--muted">
          {report.limitations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <aside className="observation-report-disclaimer">{disclaimer}</aside>

      <section className="observation-follow-up">
        <h3 className="observation-follow-up__title">可以继续问</h3>
        {report.followUpQuestions.length ? (
          <div className="chip-row chip-row--scroll">
            {report.followUpQuestions.map((item) => <button className="chip" disabled={!diagnosisAvailable || chatPending} key={item} onClick={() => onUseQuestion(item)} type="button">{item}</button>)}
          </div>
        ) : null}
      </section>

      <div className="observation-follow-up-dock">
        <ObservationFollowUpComposer
          disabled={!diagnosisAvailable}
          id={OBSERVATION_FOLLOW_UP_PAGE_INPUT_ID}
          onChange={onQuestionChange}
          onFocus={onFocusComposer}
          onSubmit={onAsk}
          pending={chatPending}
          placeholder="想继续了解什么？"
          value={question}
        />
        <p className="observation-report-foot">日常参考，不构成诊断；如有不适请咨询专业人士</p>
      </div>

      <ObservationFollowUpSheet
        avatarUri={avatarUri}
        chatPending={chatPending}
        diagnosisAvailable={diagnosisAvailable}
        displayInitial={displayInitial}
        messages={messages}
        onAsk={onAsk}
        onClose={onCloseFollowUp}
        onQuestionChange={onQuestionChange}
        onUseQuestion={onUseQuestion}
        open={followUpOpen}
        pendingQuestion={pendingQuestion}
        question={question}
        streamedAnswer={streamedAnswer}
        suggestions={report.followUpQuestions}
      />
    </>
  );
}
