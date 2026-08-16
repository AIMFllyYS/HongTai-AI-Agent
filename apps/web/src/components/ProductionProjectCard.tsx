import { useState } from "react";
import type { JsonObject, ProductionProjectRecord } from "@hongtai/core";

import { Button } from "./Buttons";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";
import { issueActionPresentation, issueTitle } from "./IssueNotice";

export interface ProductionProjectCardProps {
  readonly project: ProductionProjectRecord;
  readonly progress: number;
  readonly progressMessage: string;
  readonly busy: boolean;
  readonly onImport: () => void;
  readonly onGeneratePlan: () => void;
  readonly onRender: () => void;
  readonly onRemoveAsset: (assetId: string) => void;
  readonly onRemoveOutput: () => void;
  readonly onDeleteProject: () => void;
}

type DeleteConfirmation =
  | { readonly kind: "asset"; readonly assetId: string; readonly label: string }
  | { readonly kind: "output" }
  | { readonly kind: "project" };

export function ProductionProjectCard({ project, progress, progressMessage, busy, onImport, onGeneratePlan, onRender, onRemoveAsset, onRemoveOutput, onDeleteProject }: ProductionProjectCardProps) {
  const [confirmation, setConfirmation] = useState<DeleteConfirmation>();
  const shots = planShots(project.plan?.document);
  const rendering = project.status === "rendering";
  const changing = project.status === "planning" || rendering;
  const confirmDelete = () => {
    if (!confirmation) return;
    if (confirmation.kind === "asset") onRemoveAsset(confirmation.assetId);
    else if (confirmation.kind === "output") onRemoveOutput();
    else onDeleteProject();
    setConfirmation(undefined);
  };
  const avatarMode = project.mode === "avatar";
  const requiredVisualAssets = avatarMode ? 1 : 3;
  const usableVisualAssets = project.assets.filter((asset) => avatarMode ? asset.role === "avatar" : asset.role === "visual").length;
  const avatarAsset = avatarMode ? project.assets.find((asset) => asset.role === "avatar") : undefined;
  const avatarDurationFits = !avatarMode || (avatarAsset?.durationSeconds !== undefined && avatarAsset.durationSeconds + 0.001 >= project.targetDurationSeconds);
  const canGeneratePlan = usableVisualAssets >= requiredVisualAssets && avatarDurationFits && (!avatarMode || Boolean(project.avatarScript));
  return (
    <GlassCard className="production-project-card">
      <div className="production-section-title"><span>02</span><div><strong>{avatarMode ? "数字人口播与本地成片" : "素材与本地成片"}</strong><small>{project.brief}</small></div></div>
      <p className="production-mode-note"><Icon name={avatarMode ? "record_voice_over" : "voice"} size={16} />{avatarMode ? "保留上传数字人视频的原始口播声音；口播稿只用于生成同步字幕，不再叠加 TTS。" : "本地渲染会为制作计划中的每个镜头生成 AI 连接页已配置的中文 TTS 旁白和字幕；旧连接未配置云端 TTS 时才使用 Android 系统语音。"}</p>

      <div className="production-assets">
        {project.assets.map((asset) => (
          <article key={asset.id}>
            <div>{asset.kind === "image" ? <img alt={asset.displayName ?? "制作素材"} src={asset.uri} /> : <Icon name={asset.kind === "video" ? "movie" : "voice"} size={25} />}</div>
            <span>{asset.displayName ?? "本地素材"}</span>
            <small>{asset.role === "avatar" ? "数字人口播视频" : asset.role === "music" ? "音乐" : asset.kind === "image" ? "图片" : "视频"}</small>
            <button aria-label={`删除素材 ${asset.displayName ?? asset.id}`} className="production-asset-delete" disabled={busy || changing} onClick={() => setConfirmation({ kind: "asset", assetId: asset.id, label: asset.displayName ?? "本地素材" })} type="button"><Icon name="close" size={15} /></button>
          </article>
        ))}
        <button className="production-add-asset" disabled={busy || project.assets.length >= 12 || avatarMode && usableVisualAssets >= 1} onClick={onImport} type="button"><Icon name="upload_file" size={24} /><span>{avatarMode ? "上传数字人视频" : "上传素材"}</span><small>{avatarMode ? `${usableVisualAssets}/1` : `${project.assets.length}/12`}</small></button>
      </div>

      {!canGeneratePlan ? <p className="production-hint"><Icon name="info" size={16} />{avatarMode ? !avatarDurationFits && avatarAsset ? `该数字人视频不足 ${project.targetDurationSeconds} 秒，请上传更长视频或新建较短时长项目。` : "请上传一个带原声的 MP4 数字人口播视频，并确认已填写与它一致的口播稿。" : "至少上传 3 个图片或视频素材，才能生成制作计划。"}</p> : null}
      <div className="production-actions">
        <Button disabled={busy || !canGeneratePlan || rendering} onClick={onGeneratePlan} variant="secondary"><Icon name="auto_awesome" size={18} />AI 生成制作计划</Button>
        <Button disabled={busy || !project.plan || rendering} onClick={onRender}><Icon name="movie_edit" size={18} />本地合成视频</Button>
      </div>

      {project.issue ? (
        <aside className={`issue-notice issue-notice--${project.issue.severity}`} role={project.issue.severity === "error" ? "alert" : "status"}>
          <strong>{issueTitle(project.issue)}</strong>
          <small>{`${project.issue.userMessage}\n${issueActionPresentation(project.issue.action).guidance}`}</small>
        </aside>
      ) : null}

      {shots.length > 0 ? <div className="production-shot-list"><h3>制作计划</h3>{shots.map((shot) => <article key={shot.order}><em>{String(shot.order).padStart(2, "0")}</em><div><strong>{shot.caption}</strong><p>{shot.narration}</p></div><small>{shot.durationSeconds} 秒</small></article>)}</div> : null}

      {rendering || progress > 0 && progress < 100 ? <div className="production-render-progress"><div><span>{progressMessage || "正在本地合成"}</span><strong>{progress}%</strong></div><progress max={100} value={progress} /></div> : null}
      {project.output ? <div className="production-output"><video controls playsInline preload="metadata" src={project.output.uri} /><div><strong><Icon name="check_circle" size={18} />本地成片已完成</strong><small>{project.output.durationSeconds?.toFixed(1)} 秒 · MP4</small><Button disabled={busy || changing} onClick={() => setConfirmation({ kind: "output" })} variant="quiet"><Icon name="close" size={16} />删除成片</Button></div></div> : null}

      {confirmation ? <div className="production-delete-confirm" role="alert">
        <div><strong>{confirmation.kind === "asset" ? `确认删除素材“${confirmation.label}”？` : confirmation.kind === "output" ? "确认删除成片？" : "确认删除项目？"}</strong><p>{confirmation.kind === "asset" ? "相关制作计划和成片会同时失效，需要重新生成。" : confirmation.kind === "output" ? "制作计划会保留，可以稍后重新合成。" : "项目内素材、计划、临时音频和成片都会从本机删除。"}</p></div>
        <div className="mobile-action-group"><Button disabled={busy || changing} onClick={confirmDelete}>{confirmation.kind === "asset" ? "确认删除素材" : confirmation.kind === "output" ? "确认删除成片" : "确认删除项目"}</Button><Button disabled={busy} onClick={() => setConfirmation(undefined)} variant="quiet">取消</Button></div>
      </div> : null}

      <Button className="production-delete-project" disabled={busy || changing} onClick={() => setConfirmation({ kind: "project" })} variant="quiet"><Icon name="close" size={16} />删除整个项目</Button>
    </GlassCard>
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
