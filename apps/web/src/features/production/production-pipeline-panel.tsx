import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DECORATION_CATALOGUE,
  MAX_SCRIPT_SENTENCE_CHARACTERS,
  parseScriptStoryboard,
  type MeasuredDurationViolation,
  type ProductionProjectRecord,
  type ScriptSentence,
  type SubtitleTemplateId,
  type TaskIssue,
} from "@hongtai/core";
import type { ProductionNarrationRecord, ProductionScriptRecord } from "@hongtai/capacitor-runtime";

import { Button } from "../../components/Buttons";
import { ConfirmDeleteSheet } from "../../components/ConfirmDeleteSheet";
import { DeepThinkingPanel } from "../../components/DeepThinkingPanel";
import { GlassCard } from "../../components/GlassCard";
import { Icon, type IconName } from "../../components/Icon";
import { issueActionPresentation, issueTitle, type TaskIssueActionHandlers } from "../../components/IssueNotice";
import { SubtitleTemplatePicker } from "../../components/SubtitleTemplatePicker";
import { PRODUCTION_TEXT_PRESET_LABELS, productionPreviewSource } from "./production-workbench-model";
import {
  avatarSourceShortViolation,
  composeViolationItems,
  narrationAdvisoryToComposeItems,
  PRODUCTION_PIPELINE_STAGE_LABELS,
  resolveNarrationDurationAdvisory,
  type ComposeViolationItem,
  type ProductionPipelineStage,
} from "./production-workbench-model";

/** 一次逐句编辑提交：字段省略表示不改，null 表示清空绑定。 */
export interface PipelineStoryboardEdit {
  readonly sentenceId: string;
  readonly text?: string;
  readonly assetId?: string | null;
  readonly stickerId?: string | null;
}

/** 分镜脚本生成中的流式投影：运行期内存状态，界面只做有界展示，不落盘。 */
export interface ProductionScriptStream {
  /** 初稿 generating；格式修复轮 repairing。 */
  readonly phase: "generating" | "repairing";
  /** 累积的正文流（原始 JSON 文本，未完成不猜结构）。 */
  readonly content: string;
  /** 累积的推理文本；供应商不返回推理时恒为空串。 */
  readonly reasoning: string;
  /** 累计接收的正文（content delta）字符数。 */
  readonly receivedCharacters: number;
}

export interface ProductionPipelinePanelProps {
  readonly project: ProductionProjectRecord;
  readonly stage: ProductionPipelineStage;
  /** v4 分镜脚本记录；v3 存量项目与「脚本尚未生成」的 v4 项目没有。 */
  readonly script?: ProductionScriptRecord;
  readonly scriptGenerating: boolean;
  /** 生成中的流式投影；订阅不可用或尚未收到事件时为 undefined（退化为骨架等待）。 */
  readonly scriptStream?: ProductionScriptStream;
  /** 逐句配音记录；有任何一句就绪或经历过配音调用后可用。 */
  readonly narration?: ProductionNarrationRecord;
  readonly narrationProgress?: { readonly index: number; readonly total: number };
  /** 最近一次组装返回的软违规（页面在确认放行前保留展示）。 */
  readonly composeViolations: readonly MeasuredDurationViolation[];
  readonly legacyPipeline: boolean;
  readonly busy: boolean;
  readonly progress: number;
  readonly progressMessage: string;
  readonly subtitleTemplateId: SubtitleTemplateId;
  readonly pageIssue?: TaskIssue;
  readonly onSubtitleTemplate: (templateId: SubtitleTemplateId) => void;
  readonly onImport: () => void;
  readonly onRemoveAsset: (assetId: string) => void;
  readonly onRegenerateScript: () => void;
  readonly onUpdateStoryboard: (sentences: readonly PipelineStoryboardEdit[]) => Promise<void>;
  readonly onSynthesizeSentence: (sentenceId: string) => void;
  readonly onRemoveOutput: () => void;
  readonly onDeleteProject: () => void;
  readonly onConfigureAi?: () => void;
}

type DeleteConfirmation =
  | { readonly kind: "asset"; readonly assetId: string; readonly label: string }
  | { readonly kind: "output" }
  | { readonly kind: "project" };

const STAGE_ORDER: readonly ProductionPipelineStage[] = ["requirement", "script", "narration", "compose", "output"];

const STAGE_ICONS: Readonly<Record<ProductionPipelineStage, IconName>> = {
  requirement: "movie_edit",
  script: "auto_awesome",
  narration: "record_voice_over",
  compose: "tune",
  output: "play",
};

function secondsLabel(durationMs: number): string {
  const seconds = durationMs / 1_000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * 五阶段会话面板（需求 → 分镜文稿 → 配音 → 合成 → 成片）。
 *
 * 每个阶段一个区块：已完成阶段的产物保持可见、可回改；当前阶段展开完整操作；未来
 * 阶段只给一句话预告。主按钮始终在页面头部（contextualAction），面板只承载各阶段的
 * 次级操作（逐句编辑、单句补配音、删除等）。
 */
export function ProductionPipelinePanel({
  project,
  stage,
  script,
  scriptGenerating,
  scriptStream,
  narration,
  narrationProgress,
  composeViolations,
  legacyPipeline,
  busy,
  progress,
  progressMessage,
  subtitleTemplateId,
  pageIssue,
  onSubtitleTemplate,
  onImport,
  onRemoveAsset,
  onRegenerateScript,
  onUpdateStoryboard,
  onSynthesizeSentence,
  onRemoveOutput,
  onDeleteProject,
  onConfigureAi,
}: ProductionPipelinePanelProps) {
  const [confirmation, setConfirmation] = useState<DeleteConfirmation>();
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const rendering = project.status === "rendering";
  const changing = busy || rendering;
  const storyboard = script ? parseScriptStoryboard(script.storyboard.document) : undefined;
  const storyboardSentences = storyboard?.ok ? storyboard.value.sentences : [];
  const narrationBySentence = new Map((narration?.sentences ?? []).map((sentence) => [sentence.sentenceId, sentence]));
  const narrationReady = narration?.sentences.filter((sentence) => sentence.status === "ready").length ?? 0;
  const narrationTotal = storyboardSentences.length || narration?.sentences.length || 0;
  const narrationAllReady = narrationTotal > 0 && narrationReady === narrationTotal;
  const preview = productionPreviewSource(project);
  const issueActions: TaskIssueActionHandlers = {
    configureAi: onConfigureAi,
    selectMedia: onImport,
  };

  // 软违规展示：优先用最近一次组装的实测结果；还没组装过时用配音实测时长提前预告。
  // 数字人源偏短走旁路推导（项目记录里就有源视频实测时长）：向导一键跳转或重开应用后
  // 页面没有捕获过组装结果，这条提示也不丢。
  const derivedAvatarViolations = composeViolations.some((violation) => violation.reason === "avatar-source-short")
    ? []
    : avatarSourceShortViolation(project);
  const violationItems: readonly ComposeViolationItem[] = composeViolations.length > 0
    ? composeViolationItems([...composeViolations, ...derivedAvatarViolations])
    : [
      ...(narrationAllReady && narration
        ? narrationAdvisoryToComposeItems(resolveNarrationDurationAdvisory(
          narration.totalDurationMs,
          narration.sentences.map((sentence) => sentence.durationMs ?? 0),
        ))
        : []),
      ...composeViolationItems(derivedAvatarViolations),
    ];
  const hasWordTiming = Boolean(narration?.sentences.some((sentence) => sentence.status === "ready" && sentence.alignmentSource));
  const stageIndex = STAGE_ORDER.indexOf(stage);

  const confirmDelete = () => {
    if (!confirmation) return;
    if (confirmation.kind === "asset") onRemoveAsset(confirmation.assetId);
    else if (confirmation.kind === "output") onRemoveOutput();
    else onDeleteProject();
    setConfirmation(undefined);
  };

  return (
    <GlassCard className="production-pipeline" data-pipeline-stage={stage}>
      <ol aria-label="制作阶段" className="production-pipeline-timeline">
        {STAGE_ORDER.map((item, index) => {
          const state = legacyPipeline && (item === "script" || item === "narration")
            ? "skipped"
            : index < stageIndex || item === "requirement" && stage !== "requirement"
              ? "done"
              : index === stageIndex
                ? "current"
                : "todo";
          return (
            <li className={`production-pipeline-timeline__item is-${state}`} key={item}>
              <Icon name={state === "done" ? "circle_check" : STAGE_ICONS[item]} size={18} />
              <span>{PRODUCTION_PIPELINE_STAGE_LABELS[item].title}</span>
            </li>
          );
        })}
      </ol>

      {pageIssue && pageIssue.action !== "edit_input" ? <PipelineIssue actions={issueActions} issue={pageIssue} /> : null}
      {project.issue && project.issue.code !== pageIssue?.code ? <PipelineIssue actions={issueActions} issue={project.issue} /> : null}
      {legacyPipeline ? (
        <p className="production-pipeline-legacy-note">
          <Icon name="info" size={16} />这是旧版制作项目：按当时的计划只读渲染，不再进入分镜文稿流程。
        </p>
      ) : null}

      <RequirementSection project={project} busy={changing} onImport={onImport} onRemoveAsset={(assetId, label) => setConfirmation({ kind: "asset", assetId, label })} />

      {scriptGenerating ? (
        <PipelineSection description="正在按你的需求逐句生成分镜脚本，完成后可以逐句修改。" stageState="current" title="分镜文稿">
          <ScriptGeneratingSection stream={scriptStream} />
        </PipelineSection>
      ) : script ? (
        <ScriptSection
          busy={changing}
          estimatedTotalMs={script.estimatedTotalMs}
          key={script.updatedAt}
          narrationBySentence={narrationBySentence}
          onRegenerateScript={() => {
            if (confirmingRegenerate) {
              setConfirmingRegenerate(false);
              onRegenerateScript();
              return;
            }
            setConfirmingRegenerate(true);
          }}
          onSynthesizeSentence={onSynthesizeSentence}
          onUpdateStoryboard={onUpdateStoryboard}
          project={project}
          regenerateConfirming={confirmingRegenerate}
          sentences={storyboardSentences}
          stageActive={stage === "script"}
          onCancelRegenerate={() => setConfirmingRegenerate(false)}
        />
      ) : stage === "script" ? (
        <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.script.description} stageState="current" title="分镜文稿">
          <p className="production-pipeline-hint"><Icon name="info" size={16} />还没有分镜脚本。用底部主按钮开始生成；生成失败时会在这里给出原因。</p>
        </PipelineSection>
      ) : null}

      {narration && !legacyPipeline ? (
        <NarrationSection
          busy={changing}
          narration={narration}
          narrationAllReady={narrationAllReady}
          narrationProgress={narrationProgress}
          onSynthesizeSentence={onSynthesizeSentence}
          sentences={storyboardSentences}
          stageActive={stage === "narration"}
        />
      ) : null}

      {stage === "compose" || stage === "output" && !legacyPipeline ? (
        <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.compose.description} stageState={stage === "compose" ? "current" : "done"} title="合成">
          <SubtitleTemplatePicker
            disabled={changing}
            hasWordTiming={hasWordTiming}
            labelId="production-subtitle-template-label"
            onChange={onSubtitleTemplate}
            value={subtitleTemplateId}
          />
          <p className="production-pipeline-hint"><Icon name="info" size={16} />字幕分两层：口播字幕逐句全量、自动生成不丢字；强调词在字幕内放大，贴纸与浮字是画面上额外的文字提示。</p>
          {violationItems.length > 0 ? (
            <ul className="production-pipeline-violations">
              {violationItems.map((item, index) => <li key={index}><Icon name="info" size={15} />{item.message}</li>)}
            </ul>
          ) : null}
          {composeViolations.length > 0 ? (
            <p className="production-pipeline-hint">
              <Icon name="info" size={16} />{project.output
                ? "成片已按当前素材产出。上面的提示是软边界：回改文稿、更换更长的出镜视频后可重新合成。"
                : "已按实测配音组装镜头。上面的提示是软边界：回改文稿可以修正，或用底部主按钮确认后继续合成。"}
            </p>
          ) : null}
        </PipelineSection>
      ) : null}

      {stage === "output" || rendering || project.output ? (
        <OutputSection
          busy={busy}
          legacyPipeline={legacyPipeline}
          preview={preview}
          progress={progress}
          progressMessage={progressMessage}
          project={project}
          stageActive={stage === "output"}
          onRemoveOutput={() => setConfirmation({ kind: "output" })}
        />
      ) : null}

      {confirmation ? (
        <ConfirmDeleteSheet
          busy={busy}
          confirmLabel={confirmation.kind === "asset" ? "确认删除素材" : confirmation.kind === "output" ? "确认删除成片" : "确认删除项目"}
          description={confirmation.kind === "asset" ? "绑定了这句的分镜会改用其他素材。" : confirmation.kind === "output" ? "计划会保留，可以稍后重新合成。" : "项目内素材、脚本、配音、计划与成片都会从本机删除。"}
          heading={confirmation.kind === "asset" ? `确认删除素材“${confirmation.label}”？` : confirmation.kind === "output" ? "确认删除成片？" : "确认删除项目？"}
          onClose={() => setConfirmation(undefined)}
          onConfirm={confirmDelete}
          open
          title={confirmation.kind === "asset" ? "确认删除素材" : confirmation.kind === "output" ? "确认删除成片" : "确认删除项目"}
        />
      ) : null}

      {stage !== "output" ? (
        <Button className="production-delete-project" disabled={changing} onClick={() => setConfirmation({ kind: "project" })} variant="quiet">
          <Icon name="x" size={16} />删除整个项目
        </Button>
      ) : null}
    </GlassCard>
  );
}

function PipelineSection({ title, description, stageState, children }: {
  readonly title: string;
  readonly description: string;
  readonly stageState: "current" | "done";
  readonly children: ReactNode;
}) {
  return (
    <section className={`production-pipeline-section is-${stageState}`}>
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * 分镜脚本生成中的实时区块：骨架句卡占位 + 流水文本自动滚底 + 深度思考面板。
 * JSON 没输出完的板块不猜、不渲染半截结构——等脚本记录落地后整块切换为句卡编辑。
 */
function ScriptGeneratingSection({ stream }: { readonly stream?: ProductionScriptStream }) {
  const textRef = useRef<HTMLPreElement>(null);
  const phase = stream?.phase ?? "generating";

  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight;
  }, [stream?.content]);

  return (
    <div className="production-script-stream" data-script-phase={phase}>
      <div aria-hidden="true" className="production-script-stream__skeleton">
        <span />
        <span />
        <span />
      </div>
      <pre aria-live="polite" className="production-script-stream__text" ref={textRef}>{stream?.content || "正在生成分镜脚本…"}</pre>
      <p className="production-script-stream__meta">
        <Icon name="sync" size={15} />
        {phase === "repairing"
          ? "初稿没有通过校验，正在自动修复格式…"
          : stream
            ? `正在逐句生成分镜脚本 · 已接收 ${stream.receivedCharacters} 字`
            : "正在逐句生成分镜脚本…"}
      </p>
      <DeepThinkingPanel thinking={{ status: stream?.reasoning ? "streaming" : "waiting", text: stream?.reasoning ?? "" }} />
    </div>
  );
}

function PipelineIssue({ issue, actions }: { readonly issue: TaskIssue; readonly actions?: TaskIssueActionHandlers }) {
  const presentation = issueActionPresentation(issue.action, actions);
  return (
    <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
      <strong>{issueTitle(issue)}</strong>
      <small>{`${issue.userMessage}\n${presentation.guidance}`}</small>
      {presentation.label && presentation.onAction && presentation.label !== "重试" ? <Button onClick={presentation.onAction} variant="secondary">{presentation.label}</Button> : null}
    </aside>
  );
}

function RequirementSection({ project, busy, onImport, onRemoveAsset }: {
  readonly project: ProductionProjectRecord;
  readonly busy: boolean;
  readonly onImport: () => void;
  readonly onRemoveAsset: (assetId: string, label: string) => void;
}) {
  const avatarMode = project.mode === "avatar";
  const usableVisualAssets = project.assets.filter((asset) => avatarMode ? asset.role === "avatar" : asset.role === "visual").length;
  return (
    <details className="production-pipeline-requirement">
      <summary>
        <Icon name="movie_edit" size={18} />
        <span>需求与素材</span>
        <small>{avatarMode ? `数字人 · ${project.assets.length} 个素材` : `素材剪辑 · ${project.assets.length} 个素材`}</small>
      </summary>
      <div className="production-pipeline-requirement__body">
        <dl className="production-copy">
          <div><dt>这次想讲什么</dt><dd>{project.brief}</dd></div>
          <div><dt>主文字</dt><dd>{project.headlineText || "留空，由 AI 根据真实需求生成"}</dd></div>
          <div><dt>文字预设</dt><dd>{PRODUCTION_TEXT_PRESET_LABELS[project.textPreset]}</dd></div>
        </dl>
        <div className="production-assets">
          {project.assets.map((asset) => (
            <article key={asset.id}>
              <div>{asset.kind === "image" ? <img alt={asset.displayName ?? "制作素材"} src={asset.uri} /> : <Icon name={asset.kind === "video" ? "video" : "voice"} size={25} />}</div>
              <span>{asset.displayName ?? "本地素材"}</span>
              <small>{asset.role === "avatar" ? "数字人视频" : asset.role === "music" ? "音乐" : asset.kind === "image" ? "图片" : "视频"}</small>
              {asset.reshootAdvice ? <p className="production-asset-reshoot"><Icon name="info" size={14} />{asset.reshootAdvice}</p> : null}
              <button aria-label={`删除素材 ${asset.displayName ?? asset.id}`} className="production-asset-delete" disabled={busy} onClick={() => onRemoveAsset(asset.id, asset.displayName ?? "本地素材")} type="button"><Icon name="x" size={15} /></button>
            </article>
          ))}
          <button className="production-add-asset" disabled={busy || project.assets.length >= 12 || avatarMode && usableVisualAssets >= 1} onClick={onImport} type="button">
            <Icon name="upload_file" size={24} />
            <span>{avatarMode ? "上传数字人视频" : "上传素材"}</span>
            <small>{avatarMode ? `${usableVisualAssets}/1` : `${project.assets.length}/12`}</small>
          </button>
        </div>
      </div>
    </details>
  );
}

function ScriptSection({ sentences, estimatedTotalMs, narrationBySentence, busy, stageActive, regenerateConfirming, onRegenerateScript, onCancelRegenerate, onUpdateStoryboard, onSynthesizeSentence, project }: {
  readonly sentences: readonly ScriptSentence[];
  readonly estimatedTotalMs: number;
  readonly narrationBySentence: ReadonlyMap<string, { readonly status: "ready" | "missing"; readonly durationMs?: number }>;
  readonly busy: boolean;
  readonly stageActive: boolean;
  readonly regenerateConfirming: boolean;
  readonly project: ProductionProjectRecord;
  readonly onRegenerateScript: () => void;
  readonly onCancelRegenerate: () => void;
  readonly onUpdateStoryboard: (sentences: readonly PipelineStoryboardEdit[]) => Promise<void>;
  readonly onSynthesizeSentence: (sentenceId: string) => void;
}) {
  const avatarMode = project.mode === "avatar";
  const visualAssets = project.assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
  return (
    <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.script.description} stageState={stageActive ? "current" : "done"} title="分镜文稿">
      <p className="production-pipeline-duration">
        <Icon name="video" size={16} />预估总时长约 <strong>{secondsLabel(estimatedTotalMs)}</strong> 秒（按文案字数估算，配音后以实测为准）
      </p>
      <p className="production-pipeline-hint"><Icon name="info" size={16} />口播字幕逐句全量、自动生成；AI 会自动在本句里挑最多两个关键词在字幕中放大强调，贴纸与浮字则是画面上额外的提示文字。</p>
      <div className="production-pipeline-sentences">
        {sentences.map((sentence, index) => (
          <SentenceEditor
            assetOptions={avatarMode ? [] : visualAssets}
            busy={busy}
            index={index}
            key={sentence.id}
            narration={narrationBySentence.get(sentence.id)}
            onSynthesizeSentence={onSynthesizeSentence}
            onUpdateStoryboard={onUpdateStoryboard}
            sentence={sentence}
          />
        ))}
      </div>
      <div className="production-pipeline-actions">
        {regenerateConfirming ? (
          <>
            <p className="production-pipeline-hint"><Icon name="info" size={16} />重新生成会作废当前配音、计划与成片，句子顺序与文案都会换新。确定吗？</p>
            <div className="mobile-action-group">
              <Button disabled={busy} onClick={onRegenerateScript}>重新生成</Button>
              <Button disabled={busy} onClick={onCancelRegenerate} variant="quiet">取消</Button>
            </div>
          </>
        ) : (
          <Button disabled={busy} onClick={onRegenerateScript} variant="quiet"><Icon name="auto_awesome" size={16} />重新生成分镜</Button>
        )}
      </div>
    </PipelineSection>
  );
}

function SentenceEditor({ sentence, index, narration, busy, assetOptions, onUpdateStoryboard, onSynthesizeSentence }: {
  readonly sentence: ScriptSentence;
  readonly index: number;
  readonly narration?: { readonly status: "ready" | "missing"; readonly durationMs?: number };
  readonly busy: boolean;
  readonly assetOptions: readonly { readonly id: string; readonly displayName?: string }[];
  readonly onUpdateStoryboard: (sentences: readonly PipelineStoryboardEdit[]) => Promise<void>;
  readonly onSynthesizeSentence: (sentenceId: string) => void;
}) {
  const [text, setText] = useState(sentence.text);
  const [assetId, setAssetId] = useState(sentence.assetId ?? "");
  const [stickerId, setStickerId] = useState(sentence.stickerId ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = text !== sentence.text || assetId !== (sentence.assetId ?? "") || stickerId !== (sentence.stickerId ?? "");
  const textChanged = text.trim() !== sentence.text.trim();
  const overLimit = [...text].length > MAX_SCRIPT_SENTENCE_CHARACTERS;
  const canSave = dirty && !busy && !saving && text.trim().length > 0 && !overLimit;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onUpdateStoryboard([{
        sentenceId: sentence.id,
        text,
        ...(assetId !== (sentence.assetId ?? "") ? { assetId: assetId || null } : {}),
        ...(stickerId !== (sentence.stickerId ?? "") ? { stickerId: stickerId || null } : {}),
      }]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`production-pipeline-sentence ${narration?.status === "ready" ? "is-dubbed" : ""}`}>
      <header>
        <em>{String(index + 1).padStart(2, "0")}</em>
        {narration?.status === "ready" ? (
          <span className="production-pipeline-sentence__status is-ready"><Icon name="circle_check" size={14} />已配音 · 实测 {secondsLabel(narration.durationMs ?? 0)} 秒</span>
        ) : narration ? (
          <button className="production-pipeline-sentence__status is-missing" disabled={busy} onClick={() => onSynthesizeSentence(sentence.id)} type="button">
            <Icon name="record_voice_over" size={14} />待配音{busy ? "…" : "，点此补齐"}
          </button>
        ) : null}
      </header>
      <textarea
        aria-label={`第 ${index + 1} 句口播文案`}
        disabled={busy}
        maxLength={MAX_SCRIPT_SENTENCE_CHARACTERS}
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <footer>
        {assetOptions.length > 0 ? (
          <label>
            <span>画面素材</span>
            <select disabled={busy} onChange={(event) => setAssetId(event.target.value)} value={assetId}>
              <option value="">不指定（按顺序轮换）</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName ?? "本地素材"}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span>贴纸</span>
          <select disabled={busy} onChange={(event) => setStickerId(event.target.value)} value={stickerId}>
            <option value="">无贴纸</option>
            {DECORATION_CATALOGUE.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <small>约 {secondsLabel(sentence.estimatedMs)} 秒{dirty && textChanged ? "（保存后重估）" : ""}</small>
        {dirty ? <Button disabled={!canSave} onClick={() => void save()} variant="secondary">{saving ? "保存中…" : "保存修改"}</Button> : null}
      </footer>
      {overLimit ? <p className="production-pipeline-sentence__error">这句超过 {MAX_SCRIPT_SENTENCE_CHARACTERS} 字上限，请精简。</p> : null}
    </article>
  );
}

function NarrationSection({ sentences, narration, narrationProgress, narrationAllReady, busy, stageActive, onSynthesizeSentence }: {
  readonly sentences: readonly ScriptSentence[];
  readonly narration: ProductionNarrationRecord;
  readonly narrationProgress?: { readonly index: number; readonly total: number };
  readonly narrationAllReady: boolean;
  readonly busy: boolean;
  readonly stageActive: boolean;
  readonly onSynthesizeSentence: (sentenceId: string) => void;
}) {
  const textById = new Map(sentences.map((sentence) => [sentence.id, sentence.text]));
  const failures = narration.failures;
  const hasWhisperFallback = narration.sentences.some((sentence) => sentence.status === "ready" && sentence.alignmentSource === "whisper_fallback");
  return (
    <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.narration.description} stageState={stageActive ? "current" : "done"} title="配音">
      <p className="production-pipeline-duration">
        <Icon name="record_voice_over" size={16} />
        已就绪 <strong>{narration.sentences.filter((sentence) => sentence.status === "ready").length}</strong>/{narration.sentences.length} 句
        {narration.totalDurationMs > 0 ? <> · 实测总时长约 <strong>{secondsLabel(narration.totalDurationMs)}</strong> 秒</> : null}
      </p>
      {narrationProgress && busy ? (
        <div className="production-render-progress">
          <div><span>正在逐句合成配音（{narrationProgress.index}/{narrationProgress.total}）</span></div>
          <progress max={narrationProgress.total} value={narrationProgress.index} />
        </div>
      ) : null}
      <ul className="production-pipeline-narration-list">
        {narration.sentences.map((sentence, index) => (
          <li className={`is-${sentence.status}`} key={sentence.sentenceId}>
            <em>{String(index + 1).padStart(2, "0")}</em>
            <p>{textById.get(sentence.sentenceId) ?? "（文案已更新）"}</p>
            {sentence.status === "ready" ? (
              <small><Icon name="circle_check" size={14} />{secondsLabel(sentence.durationMs ?? 0)} 秒</small>
            ) : (
              <button disabled={busy} onClick={() => onSynthesizeSentence(sentence.sentenceId)} type="button">
                <Icon name="record_voice_over" size={14} />补配音
              </button>
            )}
          </li>
        ))}
      </ul>
      {failures.length > 0 ? (
        <ul className="production-pipeline-violations">
          {failures.map((failure) => (
            <li key={failure.sentenceId}>
              <Icon name="info" size={15} />
              {textById.get(failure.sentenceId) ? `这句配音失败：${failure.issue.userMessage}` : failure.issue.userMessage}
              <button disabled={busy} onClick={() => onSynthesizeSentence(failure.sentenceId)} type="button">重试这句</button>
            </li>
          ))}
        </ul>
      ) : null}
      {narrationAllReady ? (
        <p className="production-pipeline-hint">
          <Icon name="circle_check" size={16} />配音全部就绪。继续下一步前可回改任何一句文案：只有被改的句子需要重新配音。
        </p>
      ) : null}
      {hasWhisperFallback ? (
        <p className="production-pipeline-hint"><Icon name="info" size={16} />部分句子没有词级时间戳，字幕边界由语音转写反查对齐，可能有细微偏差（界面如实标注，不伪造逐字对齐）。</p>
      ) : null}
    </PipelineSection>
  );
}

function OutputSection({ project, preview, progress, progressMessage, busy, stageActive, legacyPipeline, onRemoveOutput }: {
  readonly project: ProductionProjectRecord;
  readonly preview: ReturnType<typeof productionPreviewSource>;
  readonly progress: number;
  readonly progressMessage: string;
  readonly busy: boolean;
  readonly stageActive: boolean;
  readonly legacyPipeline: boolean;
  readonly onRemoveOutput: () => void;
}) {
  const rendering = project.status === "rendering";
  return (
    <PipelineSection description={legacyPipeline ? "旧版项目的成片与渲染进度。" : PRODUCTION_PIPELINE_STAGE_LABELS.output.description} stageState={stageActive ? "current" : "done"} title="成片">
      <div className="production-preview-frame" data-preview-kind={preview.kind}>
        {preview.kind === "output" && preview.uri ? <video controls playsInline preload="metadata" src={preview.uri} /> : null}
        {preview.kind === "image" && preview.uri ? <img alt="制作素材" src={preview.uri} /> : null}
        {preview.kind === "video" && preview.uri ? <video muted playsInline preload="metadata" src={preview.uri} /> : null}
        {preview.kind === "empty" ? <div className="production-preview-frame__empty"><Icon name="movie_edit" size={36} /><span>成片会显示在这里</span></div> : null}
      </div>
      {rendering || progress > 0 && progress < 100 ? (
        <div className="production-render-progress">
          <div><span>{progressMessage || "正在本地合成"}</span><strong>{progress}%</strong></div>
          <progress max={100} value={progress} />
        </div>
      ) : null}
      {project.output ? <p className="production-pipeline-hint"><Icon name="circle_check" size={16} />成片只保存在本机，不会上传。</p> : null}
      {project.output ? <Button disabled={busy || rendering} onClick={onRemoveOutput} variant="quiet"><Icon name="x" size={16} />删除成片</Button> : null}
    </PipelineSection>
  );
}
