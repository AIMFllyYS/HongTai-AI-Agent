import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, DiagnosisMessage, DiagnosisReportRecord, DiagnosisSessionRecord, StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { Sheet } from "../components/Sheet";
import { EmptyState, ErrorState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
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
import { diagnosisModuleDefinitions } from "../features/diagnosis/diagnosis-module-progress";
import { useAppResume } from "../hooks/useAppResume";
import { observationNewPath, type Navigate } from "../router";
import { observationRecommendationIcon, observationReportSections } from "../playbook/document-sections";

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

function focusQuestion(): void {
  if (typeof document !== "undefined") document.getElementById("observation-follow-up")?.focus();
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
  const [reportPending, setReportPending] = useState(false);
  const [reportProgress, setReportProgress] = useState<StructuredGenerationProgressV1>();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<string>();
  const [followUpOpen, setFollowUpOpen] = useState(false);

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
    void load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = runtime.diagnosis.subscribeReport(sessionId, (event) => {
        if (event.type === "progress") setReportProgress(event.progress);
        if (event.type === "failed") {
          setReportProgress(event.progress);
          setIssue(event.issue);
          setReportPending(false);
          void load();
        }
        if (event.type === "completed") {
          setRecord(event.record);
          setReportProgress(undefined);
          setReportPending(false);
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

  const runReport = async () => {
    if (!diagnosisAvailable || reportPending) return;
    setReportPending(true);
    setIssue(undefined);
    setReportProgress(undefined);
    try {
      const next = await runtime.diagnosis.runReport(sessionId);
      setRecord(next);
      await load();
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "观察报告未能完成", action: "configure_ai" }));
      await load();
    } finally {
      setReportPending(false);
    }
  };

  const askQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!diagnosisAvailable || !trimmed || chatPending) return;
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
    setQuestion(value);
    setFollowUpOpen(true);
  };

  useEffect(() => {
    if (followUpOpen) focusQuestion();
  }, [followUpOpen]);

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
  const reportIsActive = record?.status === "running" || reportPending || Boolean(reportProgress);
  const reportWaitingForStart = !canShowReport && record?.status !== "failed" && !reportIsActive;
  const disclaimer = observationReportDisclaimer(report);
  const issueActions = {
    configureAi: () => navigate("/settings/ai"),
    selectMedia: () => navigate(observationNewPath()),
    retry: failedQuestion
      ? () => void askQuestion(failedQuestion)
      : reportRetryAllowed ? () => void runReport() : undefined,
    editInput: () => setFollowUpOpen(true),
  };

  return (
    <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title="观察报告" visualTheme="warm-soft-tech">
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

        {!canShowReport ? (
          <GlassCard className="observation-source-card">
            <RuntimeMediaFrame className="observation-source-card__image" label={`${observationModeLabel(session.mode)}原图`} media={session.image} />
            <div><strong>{observationModeLabel(session.mode)}图片</strong><p>图片只保存在本机，仅用于生成本次报告和回答后续问题。</p></div>
          </GlassCard>
        ) : null}

        {!diagnosisAvailable && record?.status !== "succeeded" ? <GlassCard className="observation-capability-notice" data-feature-capability="planned" tone="soft"><Icon name="pending" size={22} /><div><span>尚未接入</span><strong>本地 AI 报告能力尚未可用</strong><p>应用不会用示例结论替代真实报告。</p></div></GlassCard> : null}
        {reportWaitingForStart ? <EmptyState action={<Button disabled={!diagnosisAvailable} icon={<Icon name="auto_awesome" size={17} />} onClick={() => void runReport()}>开始生成报告</Button>} description="图片已经安全保存。报告内容会逐步显示，不需要手动刷新。" icon="pending" title="报告尚未开始生成" /> : null}
        {reportIsActive ? <ValidatedModuleProgress definitions={diagnosisModuleDefinitions} failedTitle="观察报告未完成" issue={issue ?? record?.issue} progress={reportProgress} title={reportPending && record?.status === "failed" ? "正在重新生成观察报告" : "正在生成观察报告"} /> : null}
        {record?.status === "failed" ? <ErrorState action={reportRetryAllowed ? <Button disabled={reportPending} icon={<Icon name="sync" size={17} />} onClick={() => void runReport()} variant="secondary">{reportPending ? "正在重试" : "重新生成报告"}</Button> : undefined} description="上一次报告没有生成完整内容。请根据上方提示检查后重试。" title="观察报告未完成" /> : null}
        {record?.status === "succeeded" && !canShowReport ? <ErrorState description="这份报告内容不完整，应用不会自行猜测或补写。请重新生成报告。" title="报告暂时无法展示" /> : null}

        {canShowReport && report ? <SucceededReport
          chatPending={chatPending}
          diagnosisAvailable={diagnosisAvailable}
          disclaimer={disclaimer}
          followUpOpen={followUpOpen}
          messages={messages}
          onAsk={() => void ask()}
          onCloseFollowUp={() => setFollowUpOpen(false)}
          onOpenFollowUp={() => setFollowUpOpen(true)}
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
  chatPending,
  diagnosisAvailable,
  disclaimer,
  followUpOpen,
  messages,
  onAsk,
  onCloseFollowUp,
  onOpenFollowUp,
  onQuestionChange,
  onUseQuestion,
  pendingQuestion,
  question,
  report,
  session,
  streamedAnswer,
}: {
  readonly chatPending: boolean;
  readonly diagnosisAvailable: boolean;
  readonly disclaimer: string;
  readonly followUpOpen: boolean;
  readonly messages: readonly DiagnosisMessage[];
  readonly onAsk: () => void;
  readonly onCloseFollowUp: () => void;
  readonly onOpenFollowUp: () => void;
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
                  <Icon name={observationRecommendationIcon(item.category)} size={18} />
                  <div>
                    <div className="observation-recommendation-card__top">
                      <strong>{item.title}</strong>
                      {priority ? <span className={`observation-recommendation-card__priority is-${item.priority}`}>{priority}</span> : null}
                    </div>
                    <p>{item.action}</p>
                  </div>
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
            {report.followUpQuestions.map((item) => <button className="chip" key={item} onClick={() => onUseQuestion(item)} type="button">{item}</button>)}
          </div>
        ) : null}
        <Button disabled={!diagnosisAvailable} icon={<Icon name="message_circle" size={18} />} onClick={onOpenFollowUp} variant="secondary">{messages.length > 0 ? `继续追问 · ${messages.length} 条` : "继续追问"}</Button>
        <Sheet labelledBy="observation-follow-up-title" onClose={onCloseFollowUp} open={followUpOpen} title="追问">
          {report.followUpQuestions.length ? <div className="chip-row chip-row--scroll">{report.followUpQuestions.map((item) => <button className="chip" key={item} onClick={() => onUseQuestion(item)} type="button">{item}</button>)}</div> : null}
          <div className="observation-message-list">{messages.map((message) => <article className={`observation-message is-${message.role} is-${message.status}`.trim()} key={message.id}><span><Icon name={message.role === "assistant" ? "message_circle" : "user"} size={18} /></span><p>{message.content}</p></article>)}{pendingQuestion ? <><article className="observation-message is-user is-pending"><span><Icon name="user" size={18} /></span><p>{pendingQuestion}</p></article><article className="observation-message is-assistant is-streaming"><span><Icon name="message_circle" size={18} /></span><p>{streamedAnswer || "正在生成回复…"}</p></article></> : null}</div>
          <div className="observation-question-composer"><label htmlFor="observation-follow-up">输入想继续了解的问题</label><textarea disabled={!diagnosisAvailable || chatPending} id="observation-follow-up" maxLength={20_000} onChange={(event) => onQuestionChange(event.target.value)} placeholder="例如：怎样在相近光线下做日常记录？" rows={4} value={question} /><div className="observation-question-composer__actions"><small>回复基于本次已保存报告和真实追问历史；深度思考只在报告生成进度中显示。{question.length}/20,000</small><Button className={chatPending ? "is-busy" : ""} disabled={!diagnosisAvailable || !question.trim() || chatPending} icon={<Icon name={chatPending ? "loader_circle" : "arrow_up"} size={18} />} onClick={onAsk}>{chatPending ? "正在回复" : "发送追问"}</Button></div></div>
          <Button className="sheet-cancel" onClick={onCloseFollowUp} variant="quiet">取消</Button>
        </Sheet>
      </section>

      <p className="observation-report-foot">日常参考，不构成正式诊疗；如有不适请咨询专业人士</p>
    </>
  );
}
