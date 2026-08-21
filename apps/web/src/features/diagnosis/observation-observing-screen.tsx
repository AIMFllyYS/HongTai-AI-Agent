import type {
  DiagnosisSessionRecord,
  ObservationMode,
  StructuredGenerationProgressV1,
  TaskIssue,
} from "@hongtai/core";

import { Button } from "../../components/Buttons";
import { DeepThinkingPanel } from "../../components/DeepThinkingPanel";
import { GlassCard } from "../../components/GlassCard";
import { Icon, type IconName } from "../../components/Icon";
import { IssueNotice, type TaskIssueActionHandlers } from "../../components/IssueNotice";
import { RuntimeMediaFrame } from "../../components/RuntimeMediaFrame";
import {
  buildValidatedModuleRows,
  type ValidatedModuleRow,
} from "../generation/validated-module-progress";
import { diagnosisModuleDefinitions } from "./diagnosis-module-progress";

export const OBSERVATION_OBSERVING_DISCLAIMER = "图片与报告只保存在本机；结果仅供日常参考";

const waitingThinking = { status: "waiting", text: "" } as const;

export function isObservationObservingView(reportStatus: string | undefined, canShowReport: boolean): boolean {
  return !canShowReport && reportStatus !== "succeeded";
}

export function observationScanningLabel(mode: ObservationMode): string {
  return mode === "tongue" ? "舌象扫描中" : "面部扫描中";
}

export function observationObservingStatusLabel(row: ValidatedModuleRow): string {
  if (row.status === "succeeded") return "已完成";
  if (row.status === "failed") return row.statusLabel;
  if (row.status === "pending" && !row.active) return "等待中";
  return row.statusLabel;
}

export function observationObservingStatusIcon(row: ValidatedModuleRow): IconName {
  if (row.status === "succeeded") return "check_circle";
  if (row.status === "failed") return "error";
  if (row.active) return "loader";
  return "circle";
}

export interface ObservationObservingScreenProps {
  readonly session: DiagnosisSessionRecord;
  readonly progress?: StructuredGenerationProgressV1;
  readonly issue?: TaskIssue;
  readonly issueActions?: TaskIssueActionHandlers;
  readonly diagnosisAvailable: boolean;
  readonly onCancel: () => void;
}

export function ObservationObservingScreen({
  session,
  progress,
  issue,
  issueActions,
  diagnosisAvailable,
  onCancel,
}: ObservationObservingScreenProps) {
  const rows = buildValidatedModuleRows(diagnosisModuleDefinitions, progress, issue);
  const completed = rows.filter((row) => row.status === "succeeded").length;
  const active = rows.find((row) => row.active);
  const busy = rows.some((row) => row.showSkeleton) || progress?.phase === "saving";
  const thinking = progress?.thinking ?? waitingThinking;
  const announcement = active
    ? `${active.title}：${observationObservingStatusLabel(active)}`
    : "正在生成观察报告";

  return (
    <div aria-busy={busy} className="page-stack page-observation-observing">
      {issue ? <IssueNotice actions={issueActions} issue={issue} /> : null}
      {!diagnosisAvailable ? (
        <GlassCard className="observation-capability-notice" data-feature-capability="planned" tone="soft">
          <Icon name="pending" size={22} />
          <div>
            <span>尚未接入</span>
            <strong>本地 AI 报告能力尚未可用</strong>
            <p>应用不会用示例结论替代真实报告。</p>
          </div>
        </GlassCard>
      ) : null}

      <section className="observation-observing-scan">
        <div className="observation-observing-scan__frame">
          <RuntimeMediaFrame
            className="observation-observing-scan__image"
            label={`${session.mode === "tongue" ? "舌象" : "面部"}图片`}
            media={session.image}
          />
          <span aria-hidden="true" className="observation-capture-card__laser" />
          <span aria-hidden="true" className="observation-observing-scan__brackets">
            <i /><i /><i /><i />
          </span>
        </div>
        <div className="observation-observing-scan__strip">
          <strong>{observationScanningLabel(session.mode)}</strong>
          <span className="observation-observing-scan__live"><i />分析中</span>
        </div>
      </section>

      <DeepThinkingPanel thinking={thinking} variant="observation" />

      <section className="observation-observing-modules">
        <div className="observation-observing-modules__head">
          <h3>正在生成观察报告</h3>
          <span>{completed}/5 模块</span>
        </div>
        <p aria-atomic="true" aria-live="polite" className="observation-observing-modules__announcement" role="status">{announcement}</p>
        <ol className="observation-observing-modules__list">
          {rows.map((row) => (
            <li
              className={`observation-observing-module is-${row.status}${row.active ? " is-active" : ""}`}
              data-module-id={row.moduleId}
              data-module-status={row.status}
              key={row.moduleId}
            >
              <div className="observation-observing-module__row">
                <span className="observation-observing-module__icon"><Icon name={observationObservingStatusIcon(row)} size={18} /></span>
                <strong>{row.title}</strong>
                <span className="observation-observing-module__status">{observationObservingStatusLabel(row)}</span>
              </div>
              {row.showSkeleton ? (
                <div aria-hidden="true" className="observation-observing-module__skeleton">
                  <span />
                  <span />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <Button className="observation-observing-cancel" onClick={onCancel} variant="ghost">取消本次观察</Button>
      <p className="observation-observing-disclaimer">{OBSERVATION_OBSERVING_DISCLAIMER}</p>
    </div>
  );
}
