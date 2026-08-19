import { useState } from "react";
import { resolveSubtitleTemplate, type JsonObject, type ProductionProjectRecord, type TaskIssue } from "@hongtai/core";

import { PRODUCTION_TEXT_PRESET_LABELS, PRODUCTION_WORKBENCH_TABS, productionPlanBlockedReason, productionPlanReady, productionPreviewSource, resolveProductionWorkbenchStage } from "../pages/production-workbench-model";
import { readProductionPlan } from "../features/production/production-plan-view";
import { Button } from "./Buttons";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import { issueActionPresentation, issueTitle, type TaskIssueActionHandlers } from "./IssueNotice";
import { ProductionDecorationPreview } from "./ProductionDecorationPreview";
import { TabPanel, Tabs, tabId, tabPanelId } from "./Tabs";

export interface ProductionProjectCardProps {
  readonly project: ProductionProjectRecord;
  readonly progress: number;
  readonly progressMessage: string;
  readonly busy: boolean;
  readonly pageIssue?: TaskIssue;
  readonly onImport: () => void;
  readonly onGeneratePlan: () => void;
  readonly onRemoveAsset: (assetId: string) => void;
  readonly onRemoveOutput: () => void;
  readonly onDeleteProject: () => void;
  readonly onConfigureAi?: () => void;
  /** Opens the tuning screen; absent until a plan exists to tune. */
  readonly onEditPlan?: () => void;
}

type DeleteConfirmation =
  | { readonly kind: "asset"; readonly assetId: string; readonly label: string }
  | { readonly kind: "output" }
  | { readonly kind: "project" };

const TAB_GROUP_ID = "production-workbench-tabs";

export function ProductionProjectCard({ project, progress, progressMessage, busy, pageIssue, onImport, onGeneratePlan, onRemoveAsset, onRemoveOutput, onDeleteProject, onConfigureAi, onEditPlan }: ProductionProjectCardProps) {
  const [confirmation, setConfirmation] = useState<DeleteConfirmation>();
  const [activeTab, setActiveTab] = useState<string>(PRODUCTION_WORKBENCH_TABS[0]);
  const shots = planShots(project.plan?.document);
  const rendering = project.status === "rendering";
  const changing = project.status === "planning" || rendering;
  const stage = resolveProductionWorkbenchStage({ project });
  const preview = productionPreviewSource(project);
  const planView = readProductionPlan(project.plan);
  const captionBottomOffsetPx = resolveSubtitleTemplate({
    id: planView.subtitle?.templateId ?? "classic_line",
    hasWordTiming: planView.subtitle?.precision === "word",
  }).template.layout.bottomOffsetPx;
  const avatarMode = project.mode === "avatar";
  const usableVisualAssets = project.assets.filter((asset) => avatarMode ? asset.role === "avatar" : asset.role === "visual").length;
  const canGeneratePlan = productionPlanReady(project);
  const planBlockedReason = productionPlanBlockedReason(project);
  const issueActions: TaskIssueActionHandlers = {
    configureAi: onConfigureAi,
    selectMedia: onImport,
  };
  const confirmDelete = () => {
    if (!confirmation) return;
    if (confirmation.kind === "asset") onRemoveAsset(confirmation.assetId);
    else if (confirmation.kind === "output") onRemoveOutput();
    else onDeleteProject();
    setConfirmation(undefined);
  };
  const activeIndex = Math.max(0, PRODUCTION_WORKBENCH_TABS.indexOf(activeTab as (typeof PRODUCTION_WORKBENCH_TABS)[number]));

  return (
    <GlassCard className="production-project-card">
      <div className="production-preview-frame" data-preview-kind={preview.kind}>
        {preview.kind === "output" && preview.uri ? <video controls playsInline preload="metadata" src={preview.uri} /> : null}
        {preview.kind === "image" && preview.uri ? <img alt={project.assets.find((asset) => asset.uri === preview.uri)?.displayName ?? "制作素材"} src={preview.uri} /> : null}
        {preview.kind === "video" && preview.uri ? <video muted playsInline preload="metadata" src={preview.uri} /> : null}
        {preview.kind === "empty" ? <div className="production-preview-frame__empty"><Icon name="movie_edit" size={36} /><span>成片会显示在这里</span></div> : null}
        {planView.decorations.length > 0 && preview.kind !== "output" ? (
          <ProductionDecorationPreview
            captionBottomOffsetPx={captionBottomOffsetPx}
            decorations={planView.decorations}
            shotOrder={planView.shots[0]?.order}
          />
        ) : null}
      </div>

      {rendering || progress > 0 && progress < 100 ? <div className="production-render-progress"><div><span>{progressMessage || "正在本地合成"}</span><strong>{progress}%</strong></div><progress max={100} value={progress} /></div> : null}

      {pageIssue && pageIssue.action !== "edit_input" ? <PersistentProductionIssue actions={issueActions} issue={pageIssue} /> : null}
      {project.issue && project.issue.code !== pageIssue?.code ? <PersistentProductionIssue actions={issueActions} issue={project.issue} /> : null}

      <p className="production-mode-note"><Icon name={avatarMode ? "record_voice_over" : "voice"} size={16} />{avatarMode ? "保留上传数字人视频的原始口播声音；口播稿只用于生成同步字幕，不再叠加 TTS。" : "本地渲染会为制作计划中的每个镜头生成 AI 连接页已配置的中文 TTS 旁白和字幕；旧连接未配置云端 TTS 时才使用 Android 系统语音。"}</p>

      <Tabs active={activeTab} ariaLabel="制作项目视角" id={TAB_GROUP_ID} onSelect={setActiveTab} tabs={PRODUCTION_WORKBENCH_TABS} />
      <TabPanel className="production-workbench-panel" id={tabPanelId(TAB_GROUP_ID)} labelledBy={tabId(TAB_GROUP_ID, activeIndex)}>
        {activeTab === "预览" ? (
          <div className="production-preview-tab">
            {shots.length > 0 ? <div className="production-shot-list"><h3>制作计划</h3>{shots.map((shot) => <article key={shot.order}><em>{String(shot.order).padStart(2, "0")}</em><div><strong>{shot.caption}</strong><p>{shot.narration}</p></div><small>{shot.durationSeconds} 秒</small></article>)}</div> : <p className="production-hint"><Icon name="info" size={16} />还没有制作计划。添加素材后，用底部主按钮生成。</p>}
            {planBlockedReason ? <p className="production-hint"><Icon name="info" size={16} />{planBlockedReason}</p> : null}
            {changing ? <p className="production-hint"><Icon name="sync" size={16} />{rendering ? "正在本地合成，完成前不能改素材或计划。" : "正在生成制作计划，完成前不能改素材或计划。"}</p> : null}
            {onEditPlan && project.plan && project.plan.schemaVersion !== "production-plan.v1" ? <Button disabled={busy || changing} onClick={onEditPlan} variant="secondary"><Icon name="tune" size={16} />微调字幕与镜头</Button> : null}
            {stage === "no-output" ? <Button disabled={busy || changing || !canGeneratePlan} onClick={onGeneratePlan} variant="quiet"><Icon name="auto_awesome" size={16} />重新生成计划</Button> : null}
            {project.output ? <Button disabled={busy || changing} onClick={() => setConfirmation({ kind: "output" })} variant="quiet"><Icon name="close" size={16} />删除成片</Button> : null}
          </div>
        ) : null}

        {activeTab === "文案" ? (
          <dl className="production-copy">
            <div><dt>需求</dt><dd>{project.brief}</dd></div>
            <div><dt>主文字</dt><dd>{project.headlineText || "留空，由 AI 根据真实需求生成"}</dd></div>
            <div><dt>文字预设</dt><dd>{PRODUCTION_TEXT_PRESET_LABELS[project.textPreset]}</dd></div>
            <div><dt>口播</dt><dd>{project.avatarScript || (avatarMode ? "尚未填写口播稿" : "素材剪辑模式会在本地合成时生成旁白")}</dd></div>
          </dl>
        ) : null}

        {activeTab === "素材" ? (
          <div className="production-assets-tab">
            <div className="production-assets">
              {project.assets.map((asset) => (
                <article key={asset.id}>
                  <div>{asset.kind === "image" ? <img alt={asset.displayName ?? "制作素材"} src={asset.uri} /> : <Icon name={asset.kind === "video" ? "movie" : "voice"} size={25} />}</div>
                  <span>{asset.displayName ?? "本地素材"}</span>
                  <small>{asset.role === "avatar" ? "数字人口播视频" : asset.role === "music" ? "音乐" : asset.kind === "image" ? "图片" : "视频"}</small>
                  {/* The reshoot advice is the only useful thing the app learned about a clip it
                      could not read. Dropping it leaves the user with a video whose copy ignores
                      this material and no idea that the material itself was the problem. */}
                  {asset.reshootAdvice ? <p className="production-asset-reshoot"><Icon name="error" size={14} />{asset.reshootAdvice}</p> : null}
                  <button aria-label={`删除素材 ${asset.displayName ?? asset.id}`} className="production-asset-delete" disabled={busy || changing} onClick={() => setConfirmation({ kind: "asset", assetId: asset.id, label: asset.displayName ?? "本地素材" })} type="button"><Icon name="close" size={15} /></button>
                </article>
              ))}
              <button className="production-add-asset" disabled={busy || project.assets.length >= 12 || avatarMode && usableVisualAssets >= 1} onClick={onImport} type="button"><Icon name="upload_file" size={24} /><span>{avatarMode ? "上传数字人视频" : "上传素材"}</span><small>{avatarMode ? `${usableVisualAssets}/1` : `${project.assets.length}/12`}</small></button>
            </div>
            {!canGeneratePlan ? <p className="production-hint"><Icon name="info" size={16} />{planBlockedReason}</p> : null}
          </div>
        ) : null}
      </TabPanel>

      {confirmation ? <div className="production-delete-confirm" role="alert">
        <div><strong>{confirmation.kind === "asset" ? `确认删除素材“${confirmation.label}”？` : confirmation.kind === "output" ? "确认删除成片？" : "确认删除项目？"}</strong><p>{confirmation.kind === "asset" ? "相关制作计划和成片会同时失效，需要重新生成。" : confirmation.kind === "output" ? "制作计划会保留，可以稍后重新合成。" : "项目内素材、计划、临时音频和成片都会从本机删除。"}</p></div>
        <div className="mobile-action-group"><Button disabled={busy || changing} onClick={confirmDelete}>{confirmation.kind === "asset" ? "确认删除素材" : confirmation.kind === "output" ? "确认删除成片" : "确认删除项目"}</Button><Button disabled={busy} onClick={() => setConfirmation(undefined)} variant="quiet">取消</Button></div>
      </div> : null}

      {stage !== "rendering" ? <Button className="production-delete-project" disabled={busy || changing} onClick={() => setConfirmation({ kind: "project" })} variant="quiet"><Icon name="close" size={16} />删除整个项目</Button> : null}
    </GlassCard>
  );
}

function PersistentProductionIssue({ issue, actions }: { readonly issue: TaskIssue; readonly actions?: TaskIssueActionHandlers }) {
  const presentation = issueActionPresentation(issue.action, actions);
  return (
    <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
      <strong>{issueTitle(issue)}</strong>
      <small>{`${issue.userMessage}\n${presentation.guidance}`}</small>
      {presentation.label && presentation.onAction && presentation.label !== "重试" ? <Button onClick={presentation.onAction} variant="secondary">{presentation.label}</Button> : null}
    </aside>
  );
}

interface PlanShot { readonly order: number; readonly caption: string; readonly narration: string; readonly durationSeconds: number }

function planShots(document: JsonObject | undefined): readonly PlanShot[] {
  const values = document?.shots;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const shot = value as JsonObject;
    return typeof shot.order === "number" && typeof shot.caption === "string" && typeof shot.narration === "string" && typeof shot.durationSeconds === "number"
      ? [{ order: shot.order, caption: shot.caption, narration: shot.narration, durationSeconds: shot.durationSeconds }]
      : [];
  });
}
