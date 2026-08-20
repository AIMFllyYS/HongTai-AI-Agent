import type { AppTaskRecord, ProductionMode, ProductionTextPreset } from "@hongtai/core";

import { Button } from "../../components/Buttons";
import { GlassCard } from "../../components/GlassCard";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/StatePanels";
import { Switch } from "../../components/Switch";
import { platformLabel } from "../tasks/task-presenters";

const AGENT_DURATION_OPTIONS = [15, 30, 60] as const;

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
    <>
      <span className="field-label" id="production-source-label">参考哪条拆解</span>
      <div aria-labelledby="production-source-label" className="production-source-scroller" role="listbox">
        {sources.map(({ task, title, subtitle }) => (
          <button aria-selected={task.id === sourceId} className={task.id === sourceId ? "production-source-card is-selected" : "production-source-card"} key={task.id} onClick={() => onSourceId(task.id)} role="option" type="button">
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </button>
        ))}
      </div>
    </>
  );
}

export function AgentSetupForm({
  avatarScript,
  brief,
  duration,
  headlineText,
  mode,
  onAvatarScript,
  onBrief,
  onDuration,
  onGoAnalyze,
  onHeadlineText,
  onMode,
  onSourceId,
  onTextPreset,
  sourceId,
  sources,
  textPreset,
}: {
  readonly avatarScript: string;
  readonly brief: string;
  readonly duration: number;
  readonly headlineText: string;
  readonly mode: ProductionMode;
  readonly onAvatarScript: (value: string) => void;
  readonly onBrief: (value: string) => void;
  readonly onDuration: (value: number) => void;
  readonly onGoAnalyze: () => void;
  readonly onHeadlineText: (value: string) => void;
  readonly onMode: (value: ProductionMode) => void;
  readonly onSourceId: (id: string) => void;
  readonly onTextPreset: (value: ProductionTextPreset) => void;
  readonly sourceId: string;
  readonly sources: readonly AnalysisSource[];
  readonly textPreset: ProductionTextPreset;
}) {
  const avatarOn = mode === "avatar";
  const durationValue = (AGENT_DURATION_OPTIONS as readonly number[]).includes(duration) ? duration : 30;

  return (
    <>
      <section className="production-hero">
        <h2>这次想讲什么？</h2>
      </section>
      <GlassCard className="production-setup">
        {sources.length > 0 ? (
          <>
            {avatarOn ? (
              <p className="production-hint">
                <Icon name="info" size={16} />
                上传一条已经录好自己声音的 MP4，并粘贴口播稿。应用只按稿烧字幕，不合成语音，也不改原声。字幕必须跟口播稿一致；生成后不能改口播和单镜时长。切分按字数估算，不是对着录音识别的。
              </p>
            ) : (
              <p className="production-hint">
                <Icon name="info" size={16} />
                这台安装不一定能看画面：看不到就按拆解结构写，能看到才会参考画面里看得见的内容。生成后微调页会告诉你是哪一种。两种情况都不会核对文字是否对得上每个镜头，需要你逐镜核对，看不清的素材要重拍。
              </p>
            )}
            <label className="visually-hidden" htmlFor="production-brief">{avatarOn ? "视频标题与制作需求" : "这次想讲什么"}</label>
            <textarea id="production-brief" maxLength={500} onChange={(event) => onBrief(event.target.value)} placeholder={avatarOn ? "例如：介绍门店的新服务，语气自然可信，不夸大承诺。" : "面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。"} rows={4} value={brief} />
            <small className="production-field-help">{brief.length}/500</small>
            <SourcePicker onSourceId={onSourceId} sourceId={sourceId} sources={sources} />
            <div className={avatarOn ? "production-avatar-option is-selected" : "production-avatar-option"}>
              <span id="production-avatar-option-label">
                <strong>数字人口播</strong>
                <small>已录好原声的 MP4，只烧字幕、不配音</small>
              </span>
              <Switch checked={avatarOn} labelledBy="production-avatar-option-label" onChange={(checked) => onMode(checked ? "avatar" : "montage")} />
            </div>
            <label className="field-label" htmlFor="production-headline">主文字（可选）</label>
            <input id="production-headline" maxLength={24} onChange={(event) => onHeadlineText(event.target.value)} placeholder="例如：你出时间，我出货" value={headlineText} />
            <small className="production-field-help">留空由 AI 生成；填写后成片逐字使用</small>
            <div className="production-preset-row">
              <label className="field-label" htmlFor="production-text-preset">文字预设</label>
              <select id="production-text-preset" onChange={(event) => onTextPreset(event.target.value as ProductionTextPreset)} value={textPreset}>
                <option value="classic_top">经典顶部白字</option>
                <option value="clean_card">简洁白底卡片</option>
                <option value="aqua_accent">青绿色强调</option>
              </select>
            </div>
            {avatarOn ? (
              <>
                <label className="field-label" htmlFor="production-avatar-script">数字人口播稿</label>
                <textarea id="production-avatar-script" maxLength={360} onChange={(event) => onAvatarScript(event.target.value)} placeholder="请粘贴与上传数字人视频原声一致的口播稿。它会在本地切分为短字幕，不会替换原视频声音。" rows={5} value={avatarScript} />
              </>
            ) : null}
            <span className="field-label" id="production-duration-label">目标时长</span>
            <div aria-labelledby="production-duration-label" className="production-duration-segmented" role="radiogroup">
              {AGENT_DURATION_OPTIONS.map((seconds) => (
                <button
                  aria-checked={durationValue === seconds}
                  className={durationValue === seconds ? "is-selected" : undefined}
                  key={seconds}
                  onClick={() => onDuration(seconds)}
                  role="radio"
                  type="button"
                >
                  {seconds} 秒
                </button>
              ))}
            </div>
            {avatarOn ? <small className="production-field-help">口播视频时长不能短于这个目标。旁白语速和单镜时长之后也不能改。</small> : null}
          </>
        ) : (
          <EmptyState
            action={<Button onClick={onGoAnalyze}>去拆解一条</Button>}
            description="先完成一个采集任务，并在任务详情中手动运行 AI 拆解。"
            icon="analytics"
            title="还没有可用于制作的拆解"
          />
        )}
      </GlassCard>
    </>
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
    <>
      <section className="production-hero">
        <h2>按哪条拆解复刻？</h2>
      </section>
      <GlassCard className="production-setup">
        {sources.length > 0 ? (
          <>
            <SourcePicker onSourceId={onSourceId} sourceId={sourceId} sources={sources} />
            <p className="production-hint">
              <Icon name="info" size={16} />
              下一步会打开这条拆解的复刻向导，按清单逐项绑定素材。清单不代表画面里真的有这些内容；生成的是脚本和字幕，成片要回制作页合成。
            </p>
          </>
        ) : (
          <EmptyState
            action={<Button onClick={onGoAnalyze}>去拆解一条</Button>}
            description="爆款复刻必须先有一份成功的正式拆解。先完成采集，再在任务详情里运行 AI 拆解。"
            icon="analytics"
            title="还没有可用于复刻的拆解"
          />
        )}
      </GlassCard>
    </>
  );
}
