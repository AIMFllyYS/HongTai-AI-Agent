import type { JsonObject, ProductionProjectRecord } from "@hongtai/core";

import { Button } from "./Buttons";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

export interface ProductionProjectCardProps {
  readonly project: ProductionProjectRecord;
  readonly progress: number;
  readonly progressMessage: string;
  readonly busy: boolean;
  readonly onImport: () => void;
  readonly onGeneratePlan: () => void;
  readonly onRender: () => void;
}

export function ProductionProjectCard({ project, progress, progressMessage, busy, onImport, onGeneratePlan, onRender }: ProductionProjectCardProps) {
  const shots = planShots(project.plan?.document);
  const rendering = project.status === "rendering";
  return (
    <GlassCard className="production-project-card">
      <div className="production-section-title"><span>02</span><div><strong>素材与本地成片</strong><small>{project.brief}</small></div></div>

      <div className="production-assets">
        {project.assets.map((asset) => (
          <article key={asset.id}>
            <div>{asset.kind === "image" ? <img alt={asset.displayName ?? "制作素材"} src={asset.uri} /> : <Icon name={asset.kind === "video" ? "movie" : "voice"} size={25} />}</div>
            <span>{asset.displayName ?? "本地素材"}</span>
            <small>{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "音乐"}</small>
          </article>
        ))}
        <button className="production-add-asset" disabled={busy || project.assets.length >= 12} onClick={onImport} type="button"><Icon name="upload_file" size={24} /><span>上传素材</span><small>{project.assets.length}/12</small></button>
      </div>

      {project.assets.length < 3 ? <p className="production-hint"><Icon name="info" size={16} />至少上传 3 个图片或视频素材，才能生成 production-plan.v1。</p> : null}
      <div className="production-actions">
        <Button disabled={busy || project.assets.length < 3 || rendering} onClick={onGeneratePlan} variant="secondary"><Icon name="auto_awesome" size={18} />AI 生成制作计划</Button>
        <Button disabled={busy || !project.plan || rendering} onClick={onRender}><Icon name="movie_edit" size={18} />本地合成视频</Button>
      </div>

      {shots.length > 0 ? <div className="production-shot-list"><h3>制作计划</h3>{shots.map((shot) => <article key={shot.order}><em>{String(shot.order).padStart(2, "0")}</em><div><strong>{shot.caption}</strong><p>{shot.narration}</p></div><small>{shot.durationSeconds} 秒</small></article>)}</div> : null}

      {rendering || progress > 0 && progress < 100 ? <div className="production-render-progress"><div><span>{progressMessage || "正在本地合成"}</span><strong>{progress}%</strong></div><progress max={100} value={progress} /></div> : null}
      {project.output ? <div className="production-output"><video controls playsInline preload="metadata" src={project.output.uri} /><div><strong><Icon name="check_circle" size={18} />本地成片已完成</strong><small>{project.output.durationSeconds?.toFixed(1)} 秒 · MP4</small></div></div> : null}
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
