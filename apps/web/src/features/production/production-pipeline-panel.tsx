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
import { extractClosedStreamSentences } from "./script-stream-sentences";
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
  /** 累积的正文流（原始 JSON 文本，未完成不猜结构；界面不上屏，仅供计数与调试）。 */
  readonly content: string;
  /** 累积的推理文本；供应商不返回推理时恒为空串。 */
  readonly reasoning: string;
  /** 累计接收的正文（content delta）字符数。 */
  readonly receivedCharacters: number;
  /** 已完成的分镜句数：在截断前的完整流上按稳定字段名计数，单调递增；无法计数时为 0（骨架）。 */
  readonly sentenceCount: number;
}

export interface ProductionPipelinePanelProps {
  readonly project: ProductionProjectRecord;
  /** 权威推导阶段（resolveProductionPipelineStage）：驱动主按钮与未就绪锁定，不随钉选改变。 */
  readonly stage: ProductionPipelineStage;
  /** 用户实际查看的阶段：管线运行中恒等于 stage，空闲时可被钉选粘住。 */
  readonly visibleStage: ProductionPipelineStage;
  /** 当前钉选的阶段；点击已钉选阶段由页面侧取消钉选（toggle），这里只负责呈现钉选态。 */
  readonly pinnedStage?: ProductionPipelineStage;
  /** 步骤导航钉选：用户点击某个阶段步骤时调用（页面侧负责清 pin 时机）。 */
  readonly onPinStage: (stage: ProductionPipelineStage) => void;
  /** v4 分镜脚本记录；v3 存量项目与「脚本尚未生成」的 v4 项目没有。 */
  readonly script?: ProductionScriptRecord;
  readonly scriptGenerating: boolean;
  /** 生成中的流式投影；订阅不可用或尚未收到事件时为 undefined（退化为骨架等待）。 */
  readonly scriptStream?: ProductionScriptStream;
  /** 逐句配音记录；有任何一句就绪或经历过配音调用后可用。配音批进行中可能尚未落盘（undefined）。 */
  readonly narration?: ProductionNarrationRecord;
  /** 逐句配音进度事件投影；sentenceId 是正在合成的那句（供句卡右下角「配音中」徽标）。 */
  readonly narrationProgress?: { readonly index: number; readonly total: number; readonly sentenceId?: string };
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
  readonly onConfigureAi?: () => void;
}

type DeleteConfirmation =
  | { readonly kind: "asset"; readonly assetId: string; readonly label: string }
  | { readonly kind: "output" };

const STAGE_ORDER: readonly ProductionPipelineStage[] = ["requirement", "script", "narration", "compose", "output"];

const STAGE_ICONS: Readonly<Record<ProductionPipelineStage, IconName>> = {
  requirement: "movie_edit",
  script: "auto_awesome",
  narration: "record_voice_over",
  compose: "tune",
  output: "play",
};

/** 未就绪阶段（无产物且在推导阶段之后）禁用步骤导航时给出的原因文案。 */
const STAGE_LOCKED_REASON: Readonly<Partial<Record<ProductionPipelineStage, string>>> = {
  script: "完成需求与素材后解锁",
  narration: "完成文稿后解锁",
  compose: "完成配音后解锁",
  output: "完成合成后解锁",
};

function secondsLabel(durationMs: number): string {
  const seconds = durationMs / 1_000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * 五阶段会话面板（需求 → 分镜文稿 → 配音 → 合成 → 成片）。
 *
 * 顶部时间线是可点击的步骤导航（`aria-current="step"`）：面板按 `visibleStage` 单选渲染
 * 当前阶段区块，已完成阶段的产物可回改；未就绪阶段（无产物且在推导阶段之后）禁用并给出
 * 解锁原因。主按钮始终在页面头部（contextualAction），由权威推导阶段驱动；删除项目入口
 * 在页面头部更多菜单，面板只承载素材/成片的次级删除确认。
 */
export function ProductionPipelinePanel({
  project,
  stage,
  visibleStage,
  pinnedStage,
  onPinStage,
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
  onConfigureAi,
}: ProductionPipelinePanelProps) {
  const [confirmation, setConfirmation] = useState<DeleteConfirmation>();
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const stageRegionRef = useRef<HTMLDivElement>(null);
  const previousVisibleStageRef = useRef(visibleStage);
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
  /** 各阶段是否已有产物：推导阶段之后的阶段凭产物解锁步骤导航。 */
  const stageHasArtifacts: Readonly<Record<ProductionPipelineStage, boolean>> = {
    requirement: true,
    script: Boolean(script),
    narration: Boolean(narration && narration.sentences.length > 0),
    compose: narrationAllReady || project.plan?.schemaVersion === "production-plan.v4",
    output: Boolean(project.output) || rendering,
  };

  // 步骤切换后把焦点落到阶段标题（仅钉选切换时，挂载与运行中跟随不打断用户）。
  useEffect(() => {
    if (previousVisibleStageRef.current === visibleStage) return;
    previousVisibleStageRef.current = visibleStage;
    stageRegionRef.current?.querySelector<HTMLElement>("h3, summary")?.focus();
  }, [visibleStage]);

  const confirmDelete = () => {
    if (!confirmation) return;
    if (confirmation.kind === "asset") onRemoveAsset(confirmation.assetId);
    else onRemoveOutput();
    setConfirmation(undefined);
  };

  return (
    <GlassCard className="production-pipeline" data-pipeline-stage={stage}>
      <ol aria-label="制作阶段" className="production-pipeline-timeline">
        {STAGE_ORDER.map((item, index) => {
          const skipped = legacyPipeline && (item === "script" || item === "narration");
          const done = index < stageIndex;
          const state = skipped ? "skipped" : item === visibleStage ? "current" : done ? "done" : "todo";
          // 未就绪阶段（无产物且在推导阶段之后）禁用，title 给出解锁原因；旧版项目不走
          // 分镜/配音/合成步骤，一并禁用并说明。
          const legacyOnly = legacyPipeline && item !== "requirement" && item !== "output";
          const locked = legacyOnly || (index > stageIndex && !stageHasArtifacts[item]);
          const pinned = pinnedStage === item;
          return (
            <li className={`production-pipeline-timeline__item is-${state}${pinned ? " is-pinned" : ""}`} key={item}>
              <button
                aria-current={item === visibleStage ? "step" : undefined}
                aria-pressed={pinned || undefined}
                disabled={locked}
                onClick={() => onPinStage(item)}
                title={legacyOnly ? "旧版项目按当时计划只读渲染，不走这一步" : locked ? STAGE_LOCKED_REASON[item] : pinned ? "已钉住这个阶段，再点一次取消钉选" : undefined}
                type="button"
              >
                <Icon name={!skipped && done ? "circle_check" : STAGE_ICONS[item]} size={18} />
                <span>{PRODUCTION_PIPELINE_STAGE_LABELS[item].title}</span>
              </button>
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

      {/* 按 visibleStage 单选渲染当前阶段区块；确认弹层在面板根级，不随切换卸载。 */}
      <div aria-live="polite" className="production-pipeline-stage" ref={stageRegionRef}>
        {visibleStage === "requirement" ? (
          <RequirementSection project={project} busy={changing} onImport={onImport} onRemoveAsset={(assetId, label) => setConfirmation({ kind: "asset", assetId, label })} />
        ) : null}

        {visibleStage === "script" ? (
          scriptGenerating ? (
            <PipelineSection description="正在按你的需求逐句生成分镜脚本，完成后可以逐句修改。" stageState="current" title="分镜文稿">
              <ScriptGeneratingSection stream={scriptStream} />
            </PipelineSection>
          ) : script ? (
            <ScriptSection
              busy={changing}
              estimatedTotalMs={script.estimatedTotalMs}
              narrationBySentence={narrationBySentence}
              narrationProgress={narrationProgress}
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
              stageActive={visibleStage === "script"}
              onCancelRegenerate={() => setConfirmingRegenerate(false)}
            />
          ) : (
            <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.script.description} stageState="current" title="分镜文稿">
              <p className="production-pipeline-hint"><Icon name="info" size={16} />还没有分镜脚本。用底部主按钮开始生成；生成失败时会在这里给出原因。</p>
            </PipelineSection>
          )
        ) : null}

        {visibleStage === "narration" && !legacyPipeline && (narration || narrationProgress) ? (
          <NarrationSection
            busy={changing}
            narration={narration}
            narrationAllReady={narrationAllReady}
            narrationProgress={narrationProgress}
            onSynthesizeSentence={onSynthesizeSentence}
            sentences={storyboardSentences}
            stageActive
          />
        ) : null}

        {visibleStage === "compose" && !legacyPipeline ? (
          <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.compose.description} stageState="current" title="合成">
            <SubtitleTemplatePicker
              disabled={changing}
              hasWordTiming={hasWordTiming}
              labelId="production-subtitle-template-label"
              onChange={onSubtitleTemplate}
              value={subtitleTemplateId}
            />
            <p className="production-pipeline-hint"><Icon name="info" size={16} />字幕分两层：口播字幕逐句全量、自动生成不丢字；AI 会在每句里挑最多两个关键词在字幕内放大强调，贴纸与浮字是画面上额外的文字提示。</p>
            {violationItems.length > 0 ? (
              <ul className="production-pipeline-violations">
                {violationItems.map((item, index) => <li key={index}><Icon name="info" size={15} />{item.message}</li>)}
                {/* 软边界不阻塞合成：可回改文稿修正后重新合成，或用底部主按钮确认继续。 */}
                <li><Icon name="info" size={15} />以上是软边界提示，不阻塞合成：回改文稿可以修正。</li>
              </ul>
            ) : null}
          </PipelineSection>
        ) : null}

        {visibleStage === "output" ? (
          <OutputSection
            busy={busy}
            legacyPipeline={legacyPipeline}
            preview={preview}
            progress={progress}
            progressMessage={progressMessage}
            project={project}
            stageActive
            onRemoveOutput={() => setConfirmation({ kind: "output" })}
          />
        ) : null}
      </div>

      {confirmation ? (
        <ConfirmDeleteSheet
          busy={busy}
          confirmLabel="确认删除"
          description={confirmation.kind === "asset" ? "绑定了这句的分镜会改用其他素材。" : "计划会保留，可以稍后重新合成。"}
          heading={confirmation.kind === "asset" ? `确认删除素材“${confirmation.label}”？` : "确认删除这条成片？"}
          onClose={() => setConfirmation(undefined)}
          onConfirm={confirmDelete}
          open
          title={confirmation.kind === "asset" ? "删除素材" : "删除成片"}
        />
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
        <h3 tabIndex={-1}>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * 分镜脚本生成中的实时区块：已闭合的句子渲染为真实句卡（序号/正文/贴纸/估算秒数），
 * 未闭合的下一句继续显示 pulsing 占位骨架 + 深度思考面板。原始 JSON 流不上屏；句子
 * 只从累积流里括号配对完整闭合、字段校验通过的对象提取（见 script-stream-sentences），
 * 解析失败或半截一律跳过，不猜。估算时长标注估算口径，配音后以实测为准。
 */
function ScriptGeneratingSection({ stream }: { readonly stream?: ProductionScriptStream }) {
  const phase = stream?.phase ?? "generating";
  const sentenceCount = stream?.sentenceCount ?? 0;
  const sentences = extractClosedStreamSentences(stream?.content ?? "");
  const totalMs = sentences.reduce((sum, sentence) => sum + sentence.estimatedMs, 0);
  // 4000 字符截头保尾后窗口里可能只有后段句子：按完整流句数推算起始序号，不重新从 01 编。
  const firstNumber = Math.max(1, sentenceCount - sentences.length + 1);

  return (
    <div className="production-script-stream" data-script-phase={phase}>
      {sentences.length > 0 ? (
        <p className="production-pipeline-duration">
          <Icon name="video" size={16} />预估总时长约 <strong>{secondsLabel(totalMs)}</strong> 秒（按已生成文案字数估算，以配音实测为准）
        </p>
      ) : null}
      {sentences.length > 0 ? (
        <ol aria-label="已生成分镜句" className="production-script-stream__sentences">
          {sentences.map((sentence, offset) => {
            const sticker = sentence.stickerId
              ? DECORATION_CATALOGUE.find((item) => item.id === sentence.stickerId)
              : undefined;
            return (
              <li className="production-script-stream__sentence" key={firstNumber + offset}>
                <header>
                  <em>{String(firstNumber + offset).padStart(2, "0")}</em>
                  <Icon name="circle_check" size={14} />
                  <small>约 {secondsLabel(sentence.estimatedMs)} 秒</small>
                </header>
                <p>{sentence.text}</p>
                <footer>
                  <Icon name="sparkle" size={13} />
                  <span>{sticker ? `贴纸：${sticker.label}` : "无贴纸"}</span>
                </footer>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div aria-hidden="true" className="production-script-stream__skeleton">
        {sentences.length > 0 ? <span /> : (
          <>
            <span />
            <span />
            <span />
          </>
        )}
      </div>
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

function ScriptSection({ sentences, estimatedTotalMs, narrationBySentence, narrationProgress, busy, stageActive, regenerateConfirming, onRegenerateScript, onCancelRegenerate, onUpdateStoryboard, onSynthesizeSentence, project }: {
  readonly sentences: readonly ScriptSentence[];
  readonly estimatedTotalMs: number;
  readonly narrationBySentence: ReadonlyMap<string, { readonly status: "ready" | "missing"; readonly durationMs?: number }>;
  readonly narrationProgress?: { readonly index: number; readonly total: number; readonly sentenceId?: string };
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
      {/* 字幕/贴纸分工说明只保留一处：合成阶段字幕模板旁的提示（见 compose 区块）。 */}
      <div className="production-pipeline-sentences">
        {sentences.map((sentence, index) => (
          <SentenceEditor
            assetOptions={avatarMode ? [] : visualAssets}
            busy={busy}
            index={index}
            key={sentence.id}
            narrating={busy && narrationProgress?.sentenceId === sentence.id
              ? { index: narrationProgress.index, total: narrationProgress.total }
              : undefined}
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

function SentenceEditor({ sentence, index, narration, narrating, busy, assetOptions, onUpdateStoryboard, onSynthesizeSentence }: {
  readonly sentence: ScriptSentence;
  readonly index: number;
  readonly narration?: { readonly status: "ready" | "missing"; readonly durationMs?: number };
  /** 该句正在被合成（narration-progress 事件的 sentenceId 命中）：卡片右下角给「配音中」徽标。 */
  readonly narrating?: { readonly index: number; readonly total: number };
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

  // 句卡不再随 script.updatedAt 整棵重挂载（会重置其他句的未保存输入并丢焦点）；
  // 改为引用变化时按字段内容比对同步：权威句内容真变了（保存成功、重新生成）才覆盖
  // 本地草稿；别的句保存引发的整体刷新里本句内容没变，本地输入原样保留。
  const syncedSentenceRef = useRef(sentence);
  useEffect(() => {
    const previous = syncedSentenceRef.current;
    syncedSentenceRef.current = sentence;
    if (previous === sentence) return;
    if (previous.text !== sentence.text) setText(sentence.text);
    if ((previous.assetId ?? "") !== (sentence.assetId ?? "")) setAssetId(sentence.assetId ?? "");
    if ((previous.stickerId ?? "") !== (sentence.stickerId ?? "")) setStickerId(sentence.stickerId ?? "");
  }, [sentence]);

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
        {/* 配音中徽标由真实 narration-progress 事件驱动；未确认的句子不标「已配音」。 */}
        {narrating ? (
          <span className="production-pipeline-sentence__narrating">
            <Icon name="sync" size={13} />配音中（{narrating.index}/{narrating.total}）
            <progress aria-label={`第 ${index + 1} 句配音进度`} max={narrating.total} value={narrating.index} />
          </span>
        ) : null}
        {dirty ? <Button disabled={!canSave} onClick={() => void save()} variant="secondary">{saving ? "保存中…" : "保存修改"}</Button> : null}
      </footer>
      {overLimit ? <p className="production-pipeline-sentence__error">这句超过 {MAX_SCRIPT_SENTENCE_CHARACTERS} 字上限，请精简。</p> : null}
    </article>
  );
}

function NarrationSection({ sentences, narration, narrationProgress, narrationAllReady, busy, stageActive, onSynthesizeSentence }: {
  readonly sentences: readonly ScriptSentence[];
  /** 配音记录；批进行中尚未落盘时为 undefined，逐句状态退化为「待配音/配音中」。 */
  readonly narration?: ProductionNarrationRecord;
  readonly narrationProgress?: { readonly index: number; readonly total: number; readonly sentenceId?: string };
  readonly narrationAllReady: boolean;
  readonly busy: boolean;
  readonly stageActive: boolean;
  readonly onSynthesizeSentence: (sentenceId: string) => void;
}) {
  const textById = new Map(sentences.map((sentence) => [sentence.id, sentence.text]));
  const stateBySentence = new Map((narration?.sentences ?? []).map((sentence) => [sentence.sentenceId, sentence]));
  const failures = narration?.failures ?? [];
  const readyCount = narration?.sentences.filter((sentence) => sentence.status === "ready").length ?? 0;
  const totalCount = narration?.sentences.length ?? sentences.length;
  const hasWhisperFallback = Boolean(narration?.sentences.some((sentence) => sentence.status === "ready" && sentence.alignmentSource === "whisper_fallback"));
  return (
    <PipelineSection description={PRODUCTION_PIPELINE_STAGE_LABELS.narration.description} stageState={stageActive ? "current" : "done"} title="配音">
      <p className="production-pipeline-duration">
        <Icon name="record_voice_over" size={16} />
        已就绪 <strong>{readyCount}</strong>/{totalCount} 句
        {narration && narration.totalDurationMs > 0 ? <> · 实测总时长约 <strong>{secondsLabel(narration.totalDurationMs)}</strong> 秒</> : null}
      </p>
      {narrationProgress && busy ? (
        <div className="production-render-progress">
          <div><span>正在逐句合成配音（{narrationProgress.index}/{narrationProgress.total}）</span></div>
          <progress max={narrationProgress.total} value={narrationProgress.index} />
        </div>
      ) : null}
      {/* 逐句状态：配音中由 narration-progress 的 sentenceId 驱动，ready/missing 以落盘记录为准；
          未确认的句子不标「已配音」（失败句在批末 failures 才揭晓）。 */}
      {sentences.length > 0 ? (
        <ol aria-label="逐句配音状态" className="production-pipeline-narration-sentences">
          {sentences.map((sentence, index) => {
            const state = stateBySentence.get(sentence.id);
            const narrating = busy && narrationProgress?.sentenceId === sentence.id;
            return (
              <li key={sentence.id}>
                <em>{String(index + 1).padStart(2, "0")}</em>
                <span className="production-pipeline-narration-sentences__text">{sentence.text}</span>
                {narrating ? (
                  <span className="production-pipeline-narration-sentences__status is-narrating">
                    <Icon name="sync" size={13} />配音中（{narrationProgress.index}/{narrationProgress.total}）
                  </span>
                ) : state?.status === "ready" ? (
                  <span className="production-pipeline-narration-sentences__status is-ready">
                    <Icon name="circle_check" size={13} />已配音 · 实测 {secondsLabel(state.durationMs ?? 0)} 秒
                  </span>
                ) : (
                  <span className="production-pipeline-narration-sentences__status is-missing">
                    <Icon name="record_voice_over" size={13} />待配音
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
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
