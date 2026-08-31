import { MIN_MONTAGE_VISUAL_ASSETS, type AppTaskRecord, type ProductionAsset, type ProductionMode, type ProductionTextPreset } from "@hongtai/core";

import { Button } from "../../components/Buttons";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/StatePanels";
import { Switch } from "../../components/Switch";
import { platformLabel } from "../tasks/task-presenters";

export interface AnalysisSource {
  readonly task: AppTaskRecord;
  readonly title: string;
  readonly subtitle: string;
}

export function sourceCardFromTask(task: AppTaskRecord, theme?: string): AnalysisSource {
  const platform = task.sourceKind === "local_video" ? "本地上传" : platformLabel(task.platform) ?? "内容任务";
  const day = new Date(task.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  return {
    task,
    title: `${platform} · ${day}`,
    subtitle: theme?.trim() || (task.sourceKind === "local_video" ? "我上传的视频" : "已完成的拆解"),
  };
}

export function SourcePicker({
  sourceId,
  sources,
  onSourceId,
}: {
  readonly sourceId: string;
  readonly sources: readonly AnalysisSource[];
  readonly onSourceId: (id: string) => void;
}) {
  return (
    <div className="production-field">
      <span className="field-label" id="production-source-label">参考哪条拆解</span>
      <div aria-labelledby="production-source-label" className="production-source-scroller" role="listbox">
        {sources.map(({ task, title, subtitle }) => (
          <button
            aria-selected={task.id === sourceId}
            className={task.id === sourceId ? "production-source-card is-selected" : "production-source-card"}
            key={task.id}
            onClick={() => onSourceId(task.id)}
            role="option"
            type="button"
          >
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentSetupForm({
  avatarAsset,
  avatarBusy,
  brief,
  headlineText,
  mode,
  onBrief,
  onGoAnalyze,
  onHeadlineText,
  onMode,
  onPickAvatar,
  onRemoveAvatar,
  onSourceId,
  onTextPreset,
  sourceId,
  sources,
  textPreset,
}: {
  readonly avatarAsset?: ProductionAsset;
  readonly avatarBusy?: boolean;
  readonly brief: string;
  readonly headlineText: string;
  readonly mode: ProductionMode;
  readonly onBrief: (value: string) => void;
  readonly onGoAnalyze: () => void;
  readonly onHeadlineText: (value: string) => void;
  readonly onMode: (value: ProductionMode) => void;
  readonly onPickAvatar: () => void;
  readonly onRemoveAvatar: () => void;
  readonly onSourceId: (id: string) => void;
  readonly onTextPreset: (value: ProductionTextPreset) => void;
  readonly sourceId: string;
  readonly sources: readonly AnalysisSource[];
  readonly textPreset: ProductionTextPreset;
}) {
  const avatarOn = mode === "avatar";
  const presetLabel = textPreset === "clean_card" ? "简洁白底卡片" : textPreset === "aqua_accent" ? "青绿色强调" : "经典顶部白字";

  return (
    <section className="production-agent-form" data-production-form="agent">
      <header className="production-hero">
        <h2>这次想讲什么？</h2>
      </header>

      {avatarOn ? (
        <p className="production-hint">
          <Icon name="info" size={16} />
          只需上传一段数字人预处理视频：脚本按你的需求生成，配音、字幕与画面裁剪拼接全部自动完成。视频偏短也不怕，画面会自动循环裁剪凑齐时长；视频原声会被替换成应用的配音。
        </p>
      ) : (
        <p className="production-hint">
          <Icon name="info" size={16} />
          这台安装不一定能看画面：看不到就按你的需求写，能看到才会参考画面里看得见的内容。两种情况都不会核对文字是否对得上每个镜头，需要你逐镜核对，看不清的素材要重拍。配音优先用 AI 连接里的云端旁白，没配才用系统语音。
        </p>
      )}

      <label className="production-brief-box" htmlFor="production-brief">
        <span className="visually-hidden">{avatarOn ? "视频标题与制作需求" : "这次想讲什么"}</span>
        <textarea
          id="production-brief"
          maxLength={500}
          onChange={(event) => onBrief(event.target.value)}
          placeholder={avatarOn ? "例如：介绍门店的新服务，语气自然可信，不夸大承诺。" : "例如：面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。"}
          rows={4}
          value={brief}
        />
        <small className="production-field-help">{brief.length}/500</small>
      </label>

      <div className={avatarOn ? "production-avatar-option is-selected" : "production-avatar-option"}>
        <span id="production-avatar-option-label">
          <strong>数字人出镜</strong>
          <small>上传一段数字人预处理视频，配音、字幕与画面裁剪拼接全部自动完成，不需要 {MIN_MONTAGE_VISUAL_ASSETS} 份素材</small>
        </span>
        <Switch checked={avatarOn} labelledBy="production-avatar-option-label" onChange={(checked) => onMode(checked ? "avatar" : "montage")} />
      </div>

      {avatarOn ? (
        <div className="production-avatar-upload" data-avatar-upload>
          {avatarAsset ? (
            <div className="production-avatar-upload__ready">
              <Icon name="movie" size={20} />
              <span className="production-avatar-upload__meta">
                <strong>{avatarAsset.displayName}</strong>
                <small>{avatarAsset.durationSeconds ? `约 ${Math.round(avatarAsset.durationSeconds)} 秒` : "已上传"}</small>
              </span>
              <span className="production-avatar-upload__actions">
                <button disabled={avatarBusy} onClick={onPickAvatar} type="button">更换</button>
                <button aria-label="删除数字人视频" className="is-danger" disabled={avatarBusy} onClick={onRemoveAvatar} type="button">
                  <Icon name="trash_2" size={16} />
                </button>
              </span>
            </div>
          ) : (
            <button className="production-avatar-upload__picker" disabled={avatarBusy} onClick={onPickAvatar} type="button">
              <Icon name="upload" size={20} />
              <strong>上传数字人预处理视频</strong>
              <small>选一段其他工具做好的数字人口播 MP4；上传后才能开始一键制作</small>
            </button>
          )}
        </div>
      ) : null}


      <details className="production-advanced">
        <summary>高级选项（参考拆解、主文字、文字预设）</summary>
        <div className="production-advanced__body">
          {sources.length > 0 ? (
            <SourcePicker onSourceId={onSourceId} sourceId={sourceId} sources={sources} />
          ) : (
            <div className="production-field">
              <span className="field-label" id="production-source-label">参考哪条拆解</span>
              <p className="production-hint">
                <Icon name="info" size={16} />
                还没有可参考的拆解。一句话需求也能直接开始；想让分镜更贴，可以先去拆解一条。
              </p>
              <Button onClick={onGoAnalyze} variant="secondary">去拆解一条</Button>
            </div>
          )}

          <div className="production-field">
            <label className="field-label" htmlFor="production-headline">主文字（可选）</label>
            <input
              id="production-headline"
              maxLength={24}
              onChange={(event) => onHeadlineText(event.target.value)}
              placeholder="例如：你出时间，我出货"
              value={headlineText}
            />
            <small className="production-field-help">留空由 AI 生成；填写后成片逐字使用</small>
          </div>

          <label className="production-preset-row" htmlFor="production-text-preset">
            <span>文字预设</span>
            <span className="production-preset-row__value">
              <select
                aria-label="文字预设"
                id="production-text-preset"
                onChange={(event) => onTextPreset(event.target.value as ProductionTextPreset)}
                value={textPreset}
              >
                <option value="classic_top">经典顶部白字</option>
                <option value="clean_card">简洁白底卡片</option>
                <option value="aqua_accent">青绿色强调</option>
              </select>
              <em>{presetLabel}</em>
              <Icon name="chevron_right" size={18} />
            </span>
          </label>
        </div>
      </details>
    </section>
  );
}

export function ReplicaSetupForm({
  onGoAnalyze,
  onSourceId,
  sourceId,
  sources,
}: {
  readonly onGoAnalyze: () => void;
  readonly onSourceId: (id: string) => void;
  readonly sourceId: string;
  readonly sources: readonly AnalysisSource[];
}) {
  return (
    <section className="production-replica-form" data-production-form="replica">
      <header className="production-hero">
        <h2>按哪条拆解复刻？</h2>
      </header>
      {sources.length > 0 ? (
        <>
          <SourcePicker onSourceId={onSourceId} sourceId={sourceId} sources={sources} />
          <p className="production-hint">
            <Icon name="info" size={16} />
            下一步会打开这条拆解的复刻向导，按清单逐项绑定素材。清单只说该拍什么，不代表画面里真的有这些内容；绑错文件也不会被拦住。生成的是分镜脚本和字幕，成片要回制作页合成。
          </p>
        </>
      ) : (
        <EmptyState
          action={<Button onClick={onGoAnalyze}>去拆解一条</Button>}
          description="爆款复刻必须先有一份成功的正式拆解。先完成采集，再在任务详情里运行 AI 自动拆解。"
          icon="analytics"
          title="还没有可用于复刻的拆解"
        />
      )}
    </section>
  );
}
