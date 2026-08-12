import { useCallback, useEffect, useMemo, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, DiagnosisMessage, DiagnosisReportRecord, DiagnosisSessionRecord, StructuredGenerationProgressV1, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RuntimeMediaFrame } from "../components/RuntimeMediaFrame";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanels";
import { StructuredStreamProgress } from "../components/StructuredStreamProgress";
import {
  imageQualityLabel,
  observationModeLabel,
  readDiagnosisReport,
  safetyLabel,
  visibilityLabel,
} from "../features/diagnosis/diagnosis-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { observationNewPath, type Navigate } from "../router";

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

function priorityLabel(priority: "low" | "medium" | "high"): string {
  if (priority === "high") return "优先留意";
  if (priority === "medium") return "建议安排";
  return "日常建议";
}

export function ObservationReportPage({ runtime, sessionId, navigate }: ObservationReportPageProps) {
  const diagnosisAvailable = runtime.features.diagnosis === "available";
  const [session, setSession] = useState<DiagnosisSessionRecord>();
  const [record, setRecord] = useState<DiagnosisReportRecord>();
  const [messages, setMessages] = useState<readonly DiagnosisMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [reportPending, setReportPending] = useState(false);
  const [reportProgress, setReportProgress] = useState<StructuredGenerationProgressV1>();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<string>();

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
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地观察报告暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, sessionId]);

  useAppResume(load);

  useEffect(() => {
    void load();
  }, [load]);

  const report = useMemo(() => record ? readDiagnosisReport(record) : undefined, [record]);

  const runReport = async () => {
    if (!diagnosisAvailable || reportPending) return;
    setReportPending(true);
    setIssue(undefined);
    setReportProgress(undefined);
    try {
      const next = await runtime.diagnosis.runReport(sessionId, async (event) => {
        if (event.type === "progress") setReportProgress(event.progress);
        if (event.type === "failed") setIssue(event.issue);
      });
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
    focusQuestion();
  };

  if (loading) {
    return <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title="观察报告" visualTheme="warm-soft-tech"><LoadingState description="正在读取本地保存的会话、正式报告与追问历史" title="读取观察报告" /></AppShell>;
  }
  if (!session) {
    return <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title="观察报告" visualTheme="warm-soft-tech"><ErrorState action={<Button onClick={() => navigate(observationNewPath())} variant="secondary">新建观察</Button>} description={issue?.userMessage ?? "该本地观察会话不存在，或无法安全读取。"} title="找不到观察会话" /></AppShell>;
  }

  const canShowReport = report?.available === true;
  const reportIssue = issue ?? record?.issue;
  const reportRetryAllowed = record?.status === "failed" && reportIssue?.action === "retry" && diagnosisAvailable;
  const issueActions = {
    configureAi: () => navigate("/settings/ai"),
    selectMedia: () => navigate(observationNewPath()),
    retry: failedQuestion
      ? () => void askQuestion(failedQuestion)
      : reportRetryAllowed ? () => void runReport() : undefined,
  };

  return (
    <AppShell activeNav="ai" backPath={observationNewPath()} navigate={navigate} title={observationModeLabel(session.mode)} visualTheme="warm-soft-tech">
      <div className="page-stack page-observation-report">
        <section className="observation-report-hero">
          <div><span className="eyebrow">DIAGNOSIS-REPORT.V1</span><h2>{report?.summary?.headline ?? reportStatusTitle(record)}</h2><p>单模式图片观察 · 本地保存 · 日常参考</p></div>
          <span className={`observation-report-hero__status is-${record?.status ?? "pending"}`}><Icon name={record?.status === "succeeded" ? "check_circle" : record?.status === "failed" ? "error" : "sync"} size={18} />{reportStatusTitle(record)}</span>
        </section>

        {reportIssue ? <IssueNotice actions={issueActions} issue={reportIssue} /> : null}

        <GlassCard className="observation-source-card">
          <RuntimeMediaFrame className="observation-source-card__image" label={`${observationModeLabel(session.mode)}原图`} media={session.image} />
          <div><span className="eyebrow">PRIVATE IMAGE</span><strong>{observationModeLabel(session.mode)}图片</strong><p>这张图片位于应用私有目录，仅用于此会话的正式报告与追问上下文。</p></div>
        </GlassCard>

        {!diagnosisAvailable && record?.status !== "succeeded" ? <GlassCard className="observation-capability-notice" data-feature-capability="planned" tone="soft"><Icon name="pending" size={22} /><div><span>尚未接入</span><strong>本地 AI 报告能力尚未可用</strong><p>应用不会用示例结论替代真实报告。</p></div></GlassCard> : null}
        {record?.status === "pending" || record?.status === "running" || reportPending ? <>
          <LoadingState description="正在运行正式报告；正式文档仍须通过 Schema 与安全约束校验后才会保存。" title={reportPending ? "正在重新生成报告" : "正在生成观察报告"} />
          {reportPending ? <StructuredStreamProgress progress={reportProgress} title="正在接收真实观察报告结构" /> : null}
        </> : null}
        {record?.status === "failed" ? <ErrorState action={reportRetryAllowed ? <Button disabled={reportPending} icon={<Icon name="sync" size={17} />} onClick={() => void runReport()} variant="secondary">{reportPending ? "正在重试" : "重新生成报告"}</Button> : undefined} description="上一次报告没有生成可展示的正式文档。请查看上方稳定错误代码后，再由你决定下一步。" title="观察报告未完成" /> : null}
        {record?.status === "succeeded" && !canShowReport ? <ErrorState description="已保存的报告不符合 diagnosis-report.v1 展示契约，应用不会猜测或补写字段。" title="无法安全展示报告" /> : null}

        {canShowReport && report ? <>
          <GlassCard className={`observation-quality-card is-${report.imageQuality?.overallQuality ?? "limited"}`}>
            <span><Icon name={report.imageQuality?.usable ? "check_circle" : "error"} size={23} /></span>
            <div><strong>{report.imageQuality ? imageQualityLabel(report.imageQuality.overallQuality) : "图像状态未知"}</strong><p>{report.summary?.narrative}</p></div>
            {report.imageQuality?.limitations.length ? <ul>{report.imageQuality.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          </GlassCard>

          {report.summary?.keyPoints.length ? <section className="page-section"><div className="section-heading"><div><span className="eyebrow">SUMMARY</span><h3>可见要点</h3></div></div><div className="observation-key-points">{report.summary.keyPoints.map((item) => <GlassCard key={item} tone="soft"><Icon name="visibility" size={18} /><span>{item}</span></GlassCard>)}</div></section> : null}

          <section className="page-section"><div className="section-heading"><div><span className="eyebrow">OBSERVATIONS</span><h3>图片可见观察</h3></div><span className="analysis-count">{report.observations.length} 项</span></div>{report.observations.length ? <div className="observation-report-list">{report.observations.map((item) => <GlassCard className="observation-report-item" key={item.id}><div className="observation-report-item__title"><div><span>{item.region}</span><strong>{item.label}</strong></div><small className={`is-${item.visibility}`}>{visibilityLabel(item.visibility)}</small></div><p>{item.description}</p><em><Icon name="info" size={15} />{item.evidenceDescription}</em></GlassCard>)}</div> : <EmptyState description="该报告没有可安全展示的观察项。" icon="visibility" title="暂无可见观察" />}</section>

          <section className="page-section"><div className="section-heading"><div><span className="eyebrow">DAILY REFERENCE</span><h3>日常参考</h3></div></div>{report.wellnessReferences.length ? <div className="observation-reference-list">{report.wellnessReferences.map((item) => <GlassCard className="observation-reference-card" key={item.title}><span><Icon name="lightbulb" size={20} /></span><div><strong>{item.title}</strong><p>{item.statement}</p><small>{item.certainty === "possible" ? "可能的日常参考" : "存在不确定性"}</small></div></GlassCard>)}</div> : <EmptyState description="没有可基于当前图片提供的日常参考。" icon="lightbulb" title="暂无日常参考" />}</section>

          <section className="page-section"><div className="section-heading"><div><span className="eyebrow">SUGGESTIONS</span><h3>日常建议</h3></div></div><div className="observation-recommendation-list">{report.recommendations.map((item) => <GlassCard className="observation-recommendation-card" key={item.title}><div><span className={`observation-recommendation-card__priority is-${item.priority}`}>{priorityLabel(item.priority)}</span><strong>{item.title}</strong></div><p>{item.action}</p><small>{item.rationale}</small></GlassCard>)}</div></section>

          {report.safetyGuidance ? <GlassCard className={`observation-safety-card is-${report.safetyGuidance.level}`}><Icon name={report.safetyGuidance.level === "urgent" ? "error" : "info"} size={22} /><div><strong>{safetyLabel(report.safetyGuidance.level)}</strong><p>{report.safetyGuidance.recommendedAction}</p>{report.safetyGuidance.reasons.length ? <ul>{report.safetyGuidance.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div></GlassCard> : null}

          <GlassCard className="observation-limits-card" tone="soft"><Icon name="info" size={20} /><div><strong>局限与免责声明</strong><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul><p>{report.disclaimer}</p></div></GlassCard>

          <section className="page-section observation-follow-up"><div className="section-heading"><div><span className="eyebrow">FOLLOW-UP</span><h3>继续追问</h3></div></div>{report.followUpQuestions.length ? <div className="chip-row chip-row--scroll">{report.followUpQuestions.map((item) => <button className="chip" key={item} onClick={() => useQuestion(item)} type="button">{item}</button>)}</div> : null}
            <div className="observation-message-list">{messages.map((message) => <article className={`observation-message is-${message.role} is-${message.status}`.trim()} key={message.id}><span><Icon name={message.role === "assistant" ? "smart_toy" : "face"} size={18} /></span><p>{message.content}</p></article>)}{pendingQuestion ? <><article className="observation-message is-user is-pending"><span><Icon name="face" size={18} /></span><p>{pendingQuestion}</p></article><article className="observation-message is-assistant is-streaming"><span><Icon name="smart_toy" size={18} /></span><p>{streamedAnswer || "正在生成回复…"}</p></article></> : null}</div>
            <div className="observation-question-composer"><label htmlFor="observation-follow-up">输入想继续了解的问题</label><textarea disabled={!diagnosisAvailable || chatPending} id="observation-follow-up" maxLength={20_000} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：怎样在相近光线下做日常记录？" rows={4} value={question} /><div className="observation-question-composer__actions"><small>回复基于本次已保存报告和真实追问历史，不会展示模型 reasoning。{question.length}/20,000</small><Button disabled={!diagnosisAvailable || !question.trim() || chatPending} icon={<Icon name={chatPending ? "sync" : "forum"} size={18} />} onClick={() => void ask()}>{chatPending ? "正在回复" : "发送追问"}</Button></div></div>
          </section>
        </> : null}
      </div>
    </AppShell>
  );
}
