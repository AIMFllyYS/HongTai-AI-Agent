import { safeUrlForDisplay } from "@hongtai/core";
import type { ContentAnalysisRecord, FeatureCapability, StructuredGenerationProgressV1, TaskDetailRecord, TaskIssue } from "@hongtai/core";

import { Button } from "../components/Buttons";
import { ContentAnalysisDocument } from "../components/ContentAnalysisDocument";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState, ErrorState } from "../components/StatePanels";
import { TaskCapabilityNotice } from "../components/TaskCapabilityNotice";
import { ValidatedModuleProgress } from "../components/ValidatedModuleProgress";
import { contentAnalysisModuleDefinitions } from "../features/tasks/content-analysis-module-progress";
import { readContentAnalysis } from "../features/tasks/content-analysis-presenters";
import { platformLabel } from "../features/tasks/task-presenters";
import { aiSettingsPath, type Navigate } from "../router";

export interface TaskAnalysisPageProps {
  readonly detail: TaskDetailRecord;
  readonly record?: ContentAnalysisRecord;
  readonly progress?: StructuredGenerationProgressV1;
  readonly issue?: TaskIssue;
  readonly readIssue?: TaskIssue;
  readonly contentAnalysisCapability: FeatureCapability;
  readonly navigate: Navigate;
  readonly onReload: () => void;
}

export function TaskAnalysisPage({
  detail,
  record,
  progress,
  issue,
  readIssue,
  contentAnalysisCapability,
  navigate,
  onReload,
}: TaskAnalysisPageProps) {
  const analysis = record ? readContentAnalysis(record) : undefined;
  const recordIssue = readIssue ?? issue ?? record?.issue;
  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    ...(detail.evidenceUnits.length > 0
      ? { partialResult: () => document.getElementById("task-detail-summary")?.scrollIntoView({ block: "start" }) }
      : {}),
  };
  const localVideo = detail.task.sourceKind === "local_video";
  const sourceUrl = localVideo ? "本地上传 · 仅使用已保存文稿证据" : safeUrlForDisplay(detail.content.canonicalUrl ?? detail.task.sourceUrl);
  const platform = localVideo ? "本地上传" : platformLabel(detail.task.platform);

  return (
    <div className="page-stack page-task-analysis">
      <p className="technical-value">{sourceUrl}</p>
      {platform ? <span><Icon name="language" size={15} />{platform}</span> : null}

      {recordIssue ? <IssueNotice actions={issueActions} issue={recordIssue} /> : null}
      {contentAnalysisCapability !== "available" && record?.status !== "succeeded" ? <TaskCapabilityNotice capability={contentAnalysisCapability} feature="contentAnalysis" /> : null}

      {!record || record.status === "not_started" ? (
        <EmptyState description="采集已经完成。确认后即可根据已保存的文稿或图文证据开始拆解。" icon="analytics" title="还没有开始拆解" />
      ) : null}
      {record?.status === "running" || progress ? <ValidatedModuleProgress definitions={contentAnalysisModuleDefinitions} failedTitle="这次拆解没有完成" issue={issue ?? record?.issue} progress={progress} title="AI 正在整理内容" /> : null}
      {record?.status === "failed" ? <ErrorState description="上一次拆解没有生成完整结果。请按上方提示处理后，再决定是否重新运行。" title="这次拆解没有完成" /> : null}
      {record?.status === "succeeded" && !analysis?.available ? <ErrorState description="保存的结果不完整，请重新拆解。" title="暂时无法展示结果" /> : null}
      {record?.status === "succeeded" && analysis?.available ? <ContentAnalysisDocument analysis={analysis} evidenceUnits={detail.evidenceUnits} /> : null}

      <GlassCard className="task-analysis-footer">
        <span><Icon name="info" size={18} />分析过程不会保留；页面只保存最终结果和对应的原始内容。</span>
        {readIssue ? <Button onClick={() => void onReload()} variant="quiet">重新读取本地结果</Button> : null}
      </GlassCard>
    </div>
  );
}
