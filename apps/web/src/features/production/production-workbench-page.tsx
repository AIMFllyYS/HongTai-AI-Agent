import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SUBTITLE_TEMPLATE_ID, issueFromAppError, TaskError } from "@hongtai/core";
import type {
  AppRuntime,
  MeasuredDurationViolation,
  ProductionMode,
  ProductionProjectRecord,
  ProductionTextPreset,
  SubtitleTemplateId,
  TaskIssue,
} from "@hongtai/core";
import type { AutomaticPipelineResult, MeasuredPlanComposeResult, ProductionNarrationRecord, ProductionScriptRecord, StandaloneProductionEvent } from "@hongtai/capacitor-runtime";

import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/Buttons";
import { ConfirmDeleteSheet } from "../../components/ConfirmDeleteSheet";
import { MaterialLibraryHeaderAction } from "../../components/MaterialLibraryHeaderAction";
import { Icon, type IconName } from "../../components/Icon";
import { IssueNotice, issueTitle } from "../../components/IssueNotice";
import { PageSkeleton } from "../../components/PageSkeleton";
import { TaskMoreActionsSheet } from "../../components/TaskMoreActionsSheet";
import { useSkeletonHold } from "../../motion/skeleton-hold";
import { useAppResume } from "../../hooks/useAppResume";
import { composeEntryFromSearch, consumeComposeEntryFromSearch } from "../../navigation/compose-actions";
import { aiSettingsPath, pathForRoute, replicaWizardPath } from "../../router";
import { consumeCreateSourceIdFromSearch, isEligibleCreateSourceTask, peekCreateSourceIdFromSearch, resolveCreateWorkbenchEntry } from "../../pages/task-page-model";
import { readContentAnalysis } from "../tasks/content-analysis-presenters";
import { ProductionComposerPanel, type ComposerFlow } from "./production-composer-panel";
import { ProductionHistoryList } from "./production-history-list";
import { ProductionPipelinePanel, type PipelineStoryboardEdit, type ProductionScriptStream } from "./production-pipeline-panel";
import { sourceCardFromTask, type AnalysisSource } from "./production-setup-forms";
import {
  productionRenderStageCopy,
  resolvePipelinePrimaryAction,
  resolveProductionPipelineStage,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
  scriptProductionService,
  type ProductionPipelineStage,
} from "./production-workbench-model";

function focusProductionInput(): void {
  if (typeof document === "undefined") return;
  document.getElementById("production-brief")?.focus();
}

/** 流式文本的界面累积上限：截头保尾，界面只做有界展示，绝不无限增长。 */
const SCRIPT_STREAM_MAX_CHARACTERS = 4_000;

/** 界面投影的节流间隔：trailing 节流，文案仍是真实累积值，只是降低重渲染频率。 */
const SCRIPT_STREAM_FLUSH_MS = 150;

/**
 * 已完成分镜句的稳定字段名计数：在截断前的完整累积流上数 `"text": "…"` 闭合对。
 * 绝不 JSON.parse 半截流；正则不匹配（含还没闭合的半截句）退化为 0，界面落到骨架。
 */
const STREAM_SENTENCE_PATTERN = /"text"\s*:\s*"(?:[^"\\]|\\.)*"/g;

export function countCompletedStreamSentences(content: string): number {
  return content.match(STREAM_SENTENCE_PATTERN)?.length ?? 0;
}

function appendScriptStreamText(current: string, delta: string): string {
  const next = current + delta;
  return next.length <= SCRIPT_STREAM_MAX_CHARACTERS ? next : next.slice(next.length - SCRIPT_STREAM_MAX_CHARACTERS);
}

/** script-progress 事件的页面累积状态；projectId 用于丢弃跨项目的迟到事件。 */
interface ScriptStreamState extends ProductionScriptStream {
  readonly projectId: string;
}

function shellTitleFor(flow: ComposerFlow, showComposer: boolean): string {
  if (!showComposer) return "制作";
  return flow === "replica" ? "爆款复刻" : "智能成片";
}

/** 旧「微调」路由重定向携带的 ?project= 参数：选中后即从地址栏消费，避免刷新反复触发。 */
function consumeProjectParamFromSearch(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("project")?.trim() ?? "";
  if (!requested) return "";
  params.delete("project");
  const next = params.toString();
  const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash ?? ""}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash ?? ""}` !== nextUrl) {
    window.history.replaceState(window.history.state ?? {}, "", nextUrl);
  }
  return requested;
}

export function ProductionWorkbenchPage({ runtime, navigate, searchEpoch }: { readonly runtime: AppRuntime; readonly navigate: (path: string) => void; readonly searchEpoch: number }) {
  const service = useMemo(() => scriptProductionService(runtime.production), [runtime.production]);
  const [sources, setSources] = useState<readonly AnalysisSource[]>([]);
  const [projects, setProjects] = useState<readonly ProductionProjectRecord[]>([]);
  const [project, setProject] = useState<ProductionProjectRecord>();
  const [avatarDraft, setAvatarDraft] = useState<ProductionProjectRecord>();
  const [composingNew, setComposingNew] = useState(false);
  const [composerFlow, setComposerFlow] = useState<ComposerFlow>("agent");
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<ProductionMode>("montage");
  const [headlineText, setHeadlineText] = useState("");
  const [textPreset, setTextPreset] = useState<ProductionTextPreset>("classic_top");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const [script, setScript] = useState<ProductionScriptRecord>();
  const [narration, setNarration] = useState<ProductionNarrationRecord>();
  const [scriptGenerating, setScriptGenerating] = useState(false);
  const [scriptStream, setScriptStream] = useState<ScriptStreamState>();
  const scriptStreamStopRef = useRef<(() => void) | undefined>(undefined);
  const [narrationProgress, setNarrationProgress] = useState<{ readonly index: number; readonly total: number }>();
  const [composeViolations, setComposeViolations] = useState<readonly MeasuredDurationViolation[]>([]);
  const [subtitleTemplateId, setSubtitleTemplateId] = useState<SubtitleTemplateId>(DEFAULT_SUBTITLE_TEMPLATE_ID);
  /** 步骤导航钉选：仅用户视图；管线运行中强制跟随推导阶段。仅存于本页。 */
  const [pinnedStage, setPinnedStage] = useState<ProductionPipelineStage>();
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] = useState(false);
  const composingNewRef = useRef(composingNew);
  composingNewRef.current = composingNew;
  /**
   * 上下文代际：进入 composer（再做一条/换做法）时同步 +1。perform 的 catch 若在用户
   * 离开原上下文后才落地（微任务晚于事件处理器、早于重渲染，state/ref 都来不及更新），
   * 凭代际差异识别"这是上一个上下文的失败"，不再把旧项目的错误写到新页面上。
   */
  const contextGenerationRef = useRef(0);

  const refreshPipeline = useCallback(async (projectId: string): Promise<void> => {
    const [nextScript, nextNarration] = await Promise.all([
      service.getScript(projectId).catch(() => undefined),
      service.getNarration(projectId).catch(() => undefined),
    ]);
    setScript(nextScript);
    setNarration(nextNarration);
  }, [service]);

  /**
   * 分镜脚本生成期间的专用订阅：在调用 generateScript 之前挂上（新建项目时通用订阅
   * 还没切到新项目），把 script-progress 增量累积成有界流文本。订阅失败只损失流式
   * 展示，退化为骨架等待，生成本身不受影响。
   * 增量先进闭包累积（句数在截断前的完整流上计数、单调递增），再以 ~150ms trailing
   * 节流投影到 state——界面句卡跟着真实生成节奏点亮，但不随每个 delta 重渲染。
   */
  const startScriptStream = useCallback((projectId: string): (() => void) => {
    scriptStreamStopRef.current?.();
    scriptStreamStopRef.current = undefined;
    setScriptStream({ projectId, phase: "generating", content: "", reasoning: "", receivedCharacters: 0, sentenceCount: 0 });
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let phase: ProductionScriptStream["phase"] = "generating";
    let content = "";
    let fullContent = "";
    let reasoning = "";
    let receivedCharacters = 0;
    let sentenceCount = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      setScriptStream({ projectId, phase, content, reasoning, receivedCharacters, sentenceCount });
    };
    try {
      unsubscribe = service.subscribe(projectId, (event: StandaloneProductionEvent) => {
        if (stopped || event.type !== "script-progress" || event.projectId !== projectId) return;
        phase = event.phase;
        receivedCharacters = event.receivedCharacters;
        if (event.contentDelta !== undefined) {
          fullContent += event.contentDelta;
          content = appendScriptStreamText(content, event.contentDelta);
          sentenceCount = Math.max(sentenceCount, countCompletedStreamSentences(fullContent));
        }
        if (event.reasoningDelta !== undefined) {
          reasoning = appendScriptStreamText(reasoning, event.reasoningDelta);
        }
        if (flushTimer === undefined) flushTimer = setTimeout(flush, SCRIPT_STREAM_FLUSH_MS);
      });
    } catch {
      setScriptStream(undefined);
      return () => undefined;
    }
    const stop = () => {
      stopped = true;
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      unsubscribe?.();
    };
    scriptStreamStopRef.current = stop;
    return stop;
  }, [service]);

  useEffect(() => () => { scriptStreamStopRef.current?.(); }, []);

  const load = useCallback(async () => {
    const requestedSourceId = peekCreateSourceIdFromSearch();
    const composeEntry = typeof window === "undefined" ? "" : composeEntryFromSearch(window.location.search);
    try {
      const [succeededTasks, degradedTasks, savedProjects] = await Promise.all([
        runtime.tasks.list({ status: "succeeded", limit: 20 }),
        runtime.tasks.list({ status: "degraded", limit: 20 }),
        runtime.production.list(),
      ]);
      const tasks = [...succeededTasks, ...degradedTasks].filter((task) => isEligibleCreateSourceTask(task.status));
      const records = await Promise.all(tasks.map(async (task) => ({ task, analysis: await runtime.analysis.get(task.id) })));
      const available = records
        .filter(({ analysis }) => analysis?.status === "succeeded" && analysis.result?.schemaVersion === "content-analysis.v1")
        .map(({ task, analysis }) => sourceCardFromTask(task, analysis ? readContentAnalysis(analysis).overview?.theme : undefined));
      setSources(available);
      setProjects(savedProjects);
      const availableSourceIds = available.map((item) => item.task.id);
      if (requestedSourceId) {
        const entry = resolveCreateWorkbenchEntry({
          requestedSourceId,
          availableSourceIds,
        });
        setComposingNew(true);
        setComposerFlow("agent");
        setSourceId(entry.sourceId);
        setIssue(entry.sourceMatchFailed
          ? issueFromAppError(new TaskError({ code: "CONTENT_NOT_FOUND", message: "没有找到这条可用于制作的拆解", action: "none" }), { code: "CONTENT_NOT_FOUND", message: "没有找到这条可用于制作的拆解", action: "none" })
          : undefined);
        consumeCreateSourceIdFromSearch();
      } else if (composeEntry) {
        setComposingNew(true);
        setComposerFlow(composeEntry);
        consumeComposeEntryFromSearch();
        setSourceId((current) => resolveCreateWorkbenchEntry({
          requestedSourceId: "",
          availableSourceIds,
          currentSourceId: current,
          composingNew: true,
        }).sourceId);
        setIssue(undefined);
      } else {
        setSourceId((current) => resolveCreateWorkbenchEntry({
          requestedSourceId: "",
          availableSourceIds,
          currentSourceId: current,
          composingNew: composingNewRef.current,
        }).sourceId);
        setIssue(undefined);
      }
      const requestedProject = consumeProjectParamFromSearch();
      const nextProject = requestedProject
        ? savedProjects.find((candidate) => candidate.projectId === requestedProject)
        : undefined;
      if (nextProject) {
        setComposingNew(false);
        setProject(nextProject);
      } else if (composingNewRef.current || composeEntry || requestedSourceId) {
        // 新建编排期间不选中任何项目：把列表第一条塞进选中态，会让旧项目的脚本/配音/报错
        // 在新项目失败后混进新页面（新旧数据同屏）。新建就是新建，不叠加旧项目。
        setProject(undefined);
      } else {
        setProject((current) => current
          ? savedProjects.find((candidate) => candidate.projectId === current.projectId) ?? savedProjects[0]
          : savedProjects[0]);
      }
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地制作数据暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime, searchEpoch]);

  const applyAssetRecovery = useCallback(async () => {
    try {
      const recovered = await runtime.production.consumeAssetRecovery();
      if (recovered.status === "succeeded") {
        setComposingNew(false);
        setProject(recovered.project);
        setProjects(await runtime.production.list());
        setBusy(false);
      }
      if (recovered.status === "failed") {
        setIssue(recovered.issue);
        setBusy(false);
      }
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "素材选择恢复失败，请重新选择", action: "select_media" }));
      setBusy(false);
    }
  }, [runtime]);

  useAppResume(() => {
    void load();
    void applyAssetRecovery();
  });

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading) return undefined;
    void applyAssetRecovery();
    return undefined;
  }, [applyAssetRecovery, loading]);

  // 活跃项目切换（含刚创建）时刷新脚本与配音记录；v3 存量项目两者都是 undefined。
  // 流式状态不在这里重置：新建项目时本 effect 会在 startScriptStream 之后运行，
  // 清掉会把刚挂上的流清空；流的生命周期由 startScriptStream/stop 自管。
  // 步骤导航钉选随项目切换清空（覆盖历史选择、startNewProduction、enterComposer 等路径）。
  useEffect(() => {
    const projectId = project?.projectId;
    setPinnedStage(undefined);
    setMoreOpen(false);
    setDeleteProjectConfirmOpen(false);
    setScript(undefined);
    setNarration(undefined);
    setComposeViolations([]);
    setNarrationProgress(undefined);
    if (!projectId) return undefined;
    void refreshPipeline(projectId);
    // 从向导一键跳转进来的项目可能已处于 planning（脚本在别处生成中）：补挂流式订阅，
    // 让本页直接呈现「正在生成」的流水而不是空白脚本区。本地发起的生成在调用处挂好
    // 订阅后才走到这里，且创建时状态还不是 planning，不会重复挂载清掉已有增量。
    if (project?.status === "planning") startScriptStream(projectId);
    return undefined;
  }, [project?.projectId, refreshPipeline, startScriptStream]);

  useEffect(() => {
    const projectId = project?.projectId;
    setProgress(0);
    setProgressMessage("");
    if (!projectId || composingNew) return undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = service.subscribe(projectId, (event: StandaloneProductionEvent) => {
        if (!active) return;
        if (event.type === "state") {
          if (event.project.projectId !== projectId) return;
          setProject(event.project);
          // 自动管线各阶段持久化都会发 state；同步拉取脚本/配音记录，让管线面板的
          // 阶段指示与句级状态跟着推进，而不是等整条管线结束才刷新。
          void refreshPipeline(projectId);
          return;
        }
        if (event.type === "narration-progress") {
          if (event.projectId !== projectId) return;
          if (typeof event.sentenceIndex === "number" && typeof event.total === "number") {
            setNarrationProgress({ index: event.sentenceIndex + 1, total: event.total });
          }
          return;
        }
        // script-progress 由生成期间的专用订阅累积（见 startScriptStream），这里不重复处理。
        if (event.type === "script-progress") return;
        if (event.projectId !== projectId) return;
        setProgress(event.progress);
        setProgressMessage(productionRenderStageCopy(event.stage));
      });
    } catch (error) {
      if (active) {
        setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "制作进度订阅暂时不可用", action: "none" }));
      }
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [composingNew, project?.projectId, refreshPipeline, service]);

  /** 执行一个管线动作：成功后刷新项目列表与脚本/配音记录；失败进入 issue 而不是假成功。 */
  const perform = async (action: () => Promise<ProductionProjectRecord | ProductionScriptRecord | ProductionNarrationRecord | MeasuredPlanComposeResult | AutomaticPipelineResult>) => {
    const generation = contextGenerationRef.current;
    setBusy(true);
    setIssue(undefined);
    setNarrationProgress(undefined);
    try {
      const next = await action();
      const record = next as Partial<ProductionProjectRecord> & Partial<MeasuredPlanComposeResult> & Partial<ProductionScriptRecord> & Partial<ProductionNarrationRecord>;
      const nextProject = "project" in record && record.project ? record.project as ProductionProjectRecord
        : "projectId" in record && record.projectId ? next as unknown as ProductionProjectRecord
        : undefined;
      const projectId = nextProject?.projectId ?? project?.projectId;
      // 成功也不得把已离开的用户拽回去：代际变了说明他已在别的上下文，只刷新列表。
      if (projectId && contextGenerationRef.current === generation) {
        setComposingNew(false);
        await refreshPipeline(projectId);
        setProject((await runtime.production.get(projectId)) ?? nextProject ?? project);
      }
      setProjects(await runtime.production.list());
    } catch (error) {
      // 用户已离开发起时的上下文（再做一条/换做法/选中别的项目）时，不得把这次失败
      // 甩到新页面上：失败项目自身落盘了 project.issue，历史记录与工作台里依然可见。
      if (contextGenerationRef.current === generation && !composingNewRef.current) {
        setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "本地制作操作没有完成", action: "retry" }));
      }
      const remaining = await runtime.production.list();
      setProjects(remaining);
      // 失败兜底不得拉别的项目顶包：新建流程失败保持无选中（停留 composer），已有项目
      // 操作失败保持原项目；脚本/配音刷新只针对当前真实选中的项目，不刷错对象。
      setProject((current) => {
        if (current) return remaining.find((candidate) => candidate.projectId === current.projectId) ?? current;
        return composingNewRef.current ? undefined : remaining[0];
      });
      if (!composingNewRef.current && project?.projectId) await refreshPipeline(project.projectId);
    } finally {
      setBusy(false);
      setNarrationProgress(undefined);
    }
  };

  const avatarAsset = avatarDraft?.assets.find((asset) => asset.role === "avatar");

  /**
   * composer 数字人上传：素材必须挂在真实项目记录下（素材导入以 projectId 为权威），
   * 所以第一次选取时先建 avatar 草稿项目再唤起系统选择器；草稿只承载这段视频，
   * 「一键制作成片」直接复用它跑管线，不再二次创建。
   */
  const pickAvatarVideo = async () => {
    if (busy) return;
    if (!brief.trim()) {
      setIssue(issueFromAppError(
        new TaskError({ code: "INPUT_EMPTY", message: "先填写这次想讲什么，再上传数字人视频", action: "edit_input" }),
        { code: "INPUT_EMPTY", message: "制作输入不完整", action: "edit_input" },
      ));
      focusProductionInput();
      return;
    }
    setBusy(true);
    setIssue(undefined);
    try {
      let draft = avatarDraft;
      if (!draft) {
        draft = await runtime.production.create({
          analysisTaskId: sourceId,
          brief,
          // 与 createProject 相同：v4 管线时长由文稿与实测配音驱动，此处只是契约占位值。
          targetDurationSeconds: 30,
          mode: "avatar",
          headlineText: headlineText || undefined,
          textPreset,
        });
        setAvatarDraft(draft);
        const created = draft;
        setProjects((current) => [created, ...current.filter((item) => item.projectId !== created.projectId)]);
      } else if (avatarAsset) {
        // 更换视频：avatar 项目只允许一段数字人视频，先移除旧的再唤起选择器。
        await runtime.production.removeAsset(draft.projectId, avatarAsset.id);
      }
      const updated = await runtime.production.importAssets(draft.projectId);
      setAvatarDraft(updated);
      setProjects((current) => [updated, ...current.filter((item) => item.projectId !== updated.projectId)]);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "数字人视频没有导入成功", action: "select_media" }));
      // 失败可能与「先移除旧视频」交错：以磁盘权威记录刷新草稿，不留内存假象。
      const draftId = avatarDraft?.projectId;
      if (draftId) {
        const refreshed = await runtime.production.get(draftId).catch(() => undefined);
        if (refreshed) setAvatarDraft(refreshed);
        setProjects(await runtime.production.list().catch(() => []));
      }
    } finally {
      setBusy(false);
    }
  };

  /** 删除草稿项目本身：草稿只为承载这段视频存在，移除视频即移除草稿，不留「待准备」空壳。 */
  const removeAvatarVideo = async () => {
    const draft = avatarDraft;
    if (!draft || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.production.delete(draft.projectId);
      setAvatarDraft(undefined);
      setProjects((current) => current.filter((item) => item.projectId !== draft.projectId));
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "数字人视频没有移除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    if (!brief.trim()) {
      setIssue(issueFromAppError(new TaskError({ code: "INPUT_EMPTY", message: "请填写制作需求", action: "edit_input" }), { code: "INPUT_EMPTY", message: "制作输入不完整", action: "edit_input" }));
      return;
    }
    if (mode === "avatar" && !avatarAsset) {
      setIssue(issueFromAppError(new TaskError({ code: "INPUT_EMPTY", message: "先上传一段数字人预处理视频，再开始一键制作", action: "select_media" }), { code: "INPUT_EMPTY", message: "制作输入不完整", action: "select_media" }));
      return;
    }
    await perform(async () => {
      const created = mode === "avatar" && avatarDraft
        ? avatarDraft
        : await runtime.production.create({
          analysisTaskId: sourceId,
          brief,
          // v4（文稿先行）管线时长由文稿与实测配音驱动；core 契约仍要求该字段，
          // 传区间内的占位值，新链路创建后即走自动管线，不再消费它。
          targetDurationSeconds: 30,
          mode,
          headlineText: headlineText || undefined,
          textPreset,
        });
      // 创建成功即切到管线面板并启动一键全自动管线：脚本流式生长，配音、组装与
      // 渲染依次在同一页面上推进，用户无需再逐步点击。
      setAvatarDraft(undefined);
      setComposingNew(false);
      setProject(created);
      setProjects((current) => [created, ...current.filter((item) => item.projectId !== created.projectId)]);
      const stopStream = startScriptStream(created.projectId);
      setScriptGenerating(true);
      try {
        const pipeline = await service.runAutomaticPipeline(created.projectId, { brief, subtitleTemplateId });
        // 一键路径的软违规（数字人源偏短、总时长出界等）不阻塞渲染：成片照常产出，
        // 提示保留在合成区做信息性展示，而不是像分步路径那样当作确认闸门。
        if (pipeline.softViolations.length > 0) setComposeViolations(pipeline.softViolations);
      } finally {
        stopStream();
        setScriptGenerating(false);
      }
      return (await runtime.production.get(created.projectId)) ?? created;
    });
  };

  const generateScript = async () => {
    if (!project) return;
    await perform(async () => {
      const stopStream = startScriptStream(project.projectId);
      setScriptGenerating(true);
      try {
        await service.generateScript(project.projectId);
      } finally {
        stopStream();
        setScriptGenerating(false);
      }
      return (await runtime.production.get(project.projectId)) ?? project;
    });
  };

  const synthesizeNarration = async (sentenceIds?: readonly string[]) => {
    if (!project) return;
    await perform(async () => service.synthesizeNarration(project.projectId, sentenceIds ? { sentenceIds } : undefined));
  };

  const updateStoryboard = async (sentences: readonly PipelineStoryboardEdit[]) => {
    if (!project) return;
    await perform(async () => service.updateStoryboard(project.projectId, {
      expectedUpdatedAt: project.updatedAt,
      sentences,
    }));
  };

  /** 合成阶段：先组装实测计划；软违规只在首次出现时展示并等待确认，确认后才继续渲染。 */
  const composeAndRender = async () => {
    if (!project) return;
    if (composeViolations.length > 0) {
      setComposeViolations([]);
      await perform(() => runtime.production.render(project.projectId));
      return;
    }
    await perform(async () => {
      const result = await service.composeMeasuredPlan(project.projectId, { subtitleTemplateId });
      if (result.softViolations.length > 0) {
        setComposeViolations(result.softViolations);
        return result;
      }
      return runtime.production.render(project.projectId);
    });
  };

  const deleteProject = async (projectId: string) => {
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.production.delete(projectId);
      const remaining = await runtime.production.list();
      setProjects(remaining);
      setProject(remaining[0]);
      setComposingNew(remaining.length === 0);
      if (remaining.length === 0) setComposerFlow("agent");
      setProgress(0);
      setProgressMessage("");
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "制作项目没有删除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const activeProject = composingNew ? undefined : project;
  // v3 存量判据：没有分镜脚本、但带着旧版计划。新 v4 项目在首次组装前没有计划，
  // 不属于存量；没有任何计划与脚本的旧草稿项目按 v4 处理（生成脚本即转入新管线）。
  const legacyPipeline = Boolean(activeProject && !script && activeProject.plan && activeProject.plan.schemaVersion !== "production-plan.v4");
  const narrationReady = narration?.sentences.filter((sentence) => sentence.status === "ready").length ?? 0;
  const narrationTotal = narration?.sentences.length ?? 0;
  // planning（脚本生成中）可能发生在别的页面（向导一键跳转过来）：面板要按生成中展示，
  // 而不是摆一个「还没有分镜脚本」的空脚本区。本地发起的生成由 scriptGenerating 覆盖。
  const scriptGeneratingInProject = activeProject?.status === "planning";
  const stage = resolveProductionPipelineStage({
    scriptGenerating: scriptGenerating || scriptGeneratingInProject || busy && !activeProject && composerFlow === "agent",
    legacyPipeline,
    project: activeProject
      ? {
        status: activeProject.status,
        storyboard: script,
        narration: narrationTotal > 0 ? { ready: narrationReady, total: narrationTotal } : undefined,
      }
      : undefined,
  });
  const storyboardReady = Boolean(script);
  const planComposed = activeProject?.plan?.schemaVersion === "production-plan.v4";
  const rendering = activeProject?.status === "rendering";
  const failed = activeProject?.status === "failed";
  // 双状态模型：stage 是权威推导（驱动主按钮），visibleStage 是用户视图；管线运行中
  // 强制跟随推导态（否则用户在旧步骤看不到流式进度），空闲时钉选完全粘住。
  const pipelineRunning = scriptGenerating || Boolean(scriptGeneratingInProject) || busy || Boolean(rendering);
  const visibleStage: ProductionPipelineStage = pipelineRunning ? stage : pinnedStage ?? stage;
  const primary = resolvePipelinePrimaryAction(stage, {
    storyboardReady,
    planComposed,
    rendering,
    hasOutput: Boolean(activeProject?.output),
    failed,
    busy,
  });
  const createBlocked = busy || !brief.trim() || (mode === "avatar" && !avatarAsset);
  const showComposer = !activeProject;
  const replicaComposer = showComposer && composerFlow === "replica";
  const agentComposer = showComposer && composerFlow === "agent";
  const primaryDisabled = replicaComposer
    ? busy || !sourceId
    : showComposer ? createBlocked : primary.disabled;
  const composerPrimaryVisible = replicaComposer ? sources.length > 0 : agentComposer;
  const showHistory = projects.length > 1 || composingNew && projects.length > 0;
  const shellTitle = shellTitleFor(composerFlow, showComposer);

  const enterComposer = (flow: ComposerFlow) => {
    // A leftover Agent create failure must not follow the user onto the picker or into 复刻 —
    // retry on those screens would either rebuild the abandoned project or jump into the wizard.
    contextGenerationRef.current += 1;
    setIssue(undefined);
    setProject(undefined);
    if (flow !== "agent") setMode("montage");
    if (flow === "replica") setSourceId((current) => current || sources[0]?.task.id || "");
    setComposerFlow(flow);
  };

  const startNewProduction = () => {
    contextGenerationRef.current += 1;
    setComposingNew(true);
    setIssue(undefined);
    setProject(undefined);
    setAvatarDraft(undefined);
    setMode("montage");
    setBrief("");
    setHeadlineText("");
    setComposerFlow("agent");
    setProgress(0);
    setProgressMessage("");
  };

  const retryCurrent = () => {
    if (!activeProject) {
      if (composerFlow === "replica") {
        if (sourceId) navigate(replicaWizardPath(sourceId));
        return;
      }
      void createProject();
      return;
    }
    const kind = resolveProductionRetryKind(activeProject.issue?.action ?? issue?.action);
    if (kind === "configure-ai") {
      navigate(aiSettingsPath());
      return;
    }
    if (kind === "edit-input") {
      focusProductionInput();
      return;
    }
    if (kind === "import") {
      void perform(() => runtime.production.importAssets(activeProject.projectId));
      return;
    }
    const operation = resolveProductionRetryOperation(activeProject);
    if (operation === "render") void perform(() => runtime.production.render(activeProject.projectId));
    else if (operation === "generate-plan") void generateScript();
    else void perform(() => runtime.production.importAssets(activeProject.projectId));
  };

  const runPrimary = () => {
    if (showComposer && composerFlow === "replica") {
      if (sourceId) navigate(replicaWizardPath(sourceId));
      return;
    }
    if (showComposer) {
      void createProject();
      return;
    }
    if (!activeProject) return;
    if (failed) {
      retryCurrent();
      return;
    }
    if (stage === "script") {
      if (storyboardReady) void synthesizeNarration();
      else void generateScript();
      return;
    }
    if (stage === "narration") {
      void synthesizeNarration();
      return;
    }
    if (stage === "compose") {
      void composeAndRender();
      return;
    }
    if (stage === "output") {
      if (activeProject.output) startNewProduction();
      else void perform(() => runtime.production.render(activeProject.projectId));
    }
  };

  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    selectMedia: activeProject ? () => void perform(() => runtime.production.importAssets(activeProject.projectId)) : undefined,
    editInput: focusProductionInput,
    retry: () => retryCurrent(),
  };

  const stageIcon: IconName = showComposer
    ? composerFlow === "replica" ? "list" : "movie_edit"
    : stage === "script" && !storyboardReady
      ? "auto_awesome"
      : stage === "narration"
        ? "record_voice_over"
        : stage === "compose"
          ? "bolt"
          : stage === "output" && rendering
            ? "sync"
            : stage === "output" && activeProject?.output
              ? "sparkle"
              : "play";

  const primaryLabel = rendering
    ? `${progressMessage || primary.label} ${progress}%`
    : scriptGenerating || scriptGeneratingInProject
      ? "正在生成分镜脚本…"
      : stage === "compose" && composeViolations.length > 0
        ? "了解提示，继续合成"
        : primary.label;

  const contextualAction = !showComposer || composerPrimaryVisible
    ? (
      <Button className={busy || rendering ? "is-busy" : ""} disabled={primaryDisabled} icon={<Icon name={stageIcon} size={19} />} onClick={runPrimary} size="lg">
        {primaryLabel}
      </Button>
    )
    : undefined;

  // composer 的做法切换在表单顶部分段控件里（智能成片/爆款复刻），头部不再放「更换」入口。
  const headerAction = (
    <div className="production-header-actions">
      <MaterialLibraryHeaderAction />
      {activeProject ? (
        <button
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          aria-label="更多操作"
          className="icon-button"
          disabled={busy}
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <Icon name="more_horiz" size={20} />
        </button>
      ) : null}
    </div>
  );

  const showSkeleton = useSkeletonHold(loading);
  if (showSkeleton) {
    return (
      <AppShell activeNav="create" headerAction={<MaterialLibraryHeaderAction />} navigate={navigate} title="制作">
        <PageSkeleton layout="create" />
      </AppShell>
    );
  }

  return (
    <AppShell
      activeNav="create"
      contextualAction={contextualAction}
      headerAction={headerAction}
      leadingAction={showComposer ? undefined : <span className="page-header-icon"><Icon name="movie_edit" size={24} /></span>}
      navigate={navigate}
      title={shellTitle}
    >
      <div className="page-stack page-create production-workbench" data-composer-flow={showComposer ? composerFlow : "project"} data-pipeline-stage={stage}>
        {/* 工作台里同一 issue 已由管线面板的内联横幅承载（重试走底部主按钮），
            不再额外弹顶部通知，避免同一句话一屏出现两遍。composer 没有内联横幅，
            仍走顶部通知。 */}
        {issue && showComposer && issue.action !== "none" ? <IssueNotice actions={issueActions} issue={issue} /> : null}
        {issue && showComposer && issue.action === "none" ? (
          <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
            <strong>{issueTitle(issue)}</strong>
            <small>{issue.userMessage}</small>
          </aside>
        ) : null}

        {showComposer ? (
          <ProductionComposerPanel
            avatarAsset={avatarAsset}
            avatarBusy={busy}
            brief={brief}
            flow={composerFlow}
            headlineText={headlineText}
            mode={mode}
            onBrief={setBrief}
            onGoAnalyze={() => navigate(pathForRoute("home"))}
            onHeadlineText={setHeadlineText}
            onMode={setMode}
            onPickAvatar={() => void pickAvatarVideo()}
            onRemoveAvatar={() => void removeAvatarVideo()}
            onSelectEntry={enterComposer}
            onSourceId={setSourceId}
            onTextPreset={setTextPreset}
            sourceId={sourceId}
            sources={sources}
            textPreset={textPreset}
          />
        ) : activeProject ? (
          <ProductionPipelinePanel
            busy={busy}
            composeViolations={composeViolations}
            legacyPipeline={legacyPipeline}
            narration={narration}
            narrationProgress={narrationProgress}
            onConfigureAi={() => navigate(aiSettingsPath())}
            onImport={() => void perform(() => runtime.production.importAssets(activeProject.projectId))}
            onPinStage={setPinnedStage}
            onRegenerateScript={() => void generateScript()}
            onRemoveAsset={(assetId) => void perform(() => runtime.production.removeAsset(activeProject.projectId, assetId))}
            onRemoveOutput={() => void perform(() => runtime.production.removeOutput(activeProject.projectId))}
            onSubtitleTemplate={setSubtitleTemplateId}
            onSynthesizeSentence={(sentenceId) => void synthesizeNarration([sentenceId])}
            onUpdateStoryboard={updateStoryboard}
            pageIssue={issue}
            progress={progress}
            progressMessage={progressMessage}
            project={activeProject}
            script={script}
            scriptGenerating={scriptGenerating || Boolean(scriptGeneratingInProject)}
            scriptStream={scriptStream && scriptStream.projectId === activeProject.projectId
              ? { phase: scriptStream.phase, content: scriptStream.content, reasoning: scriptStream.reasoning, receivedCharacters: scriptStream.receivedCharacters, sentenceCount: scriptStream.sentenceCount }
              : undefined}
            stage={stage}
            subtitleTemplateId={subtitleTemplateId}
            visibleStage={visibleStage}
          />
        ) : null}

        {activeProject ? (
          <TaskMoreActionsSheet
            items={[{
              id: "delete-project",
              title: "删除项目",
              description: "素材、脚本、配音、计划与成片都会从本机删除",
              icon: "error",
              onSelect: () => setDeleteProjectConfirmOpen(true),
            }]}
            onClose={() => setMoreOpen(false)}
            open={moreOpen}
          />
        ) : null}

        {activeProject && deleteProjectConfirmOpen ? (
          <ConfirmDeleteSheet
            busy={busy}
            confirmLabel="确认删除"
            description="项目内素材、脚本、配音、计划与成片都会从本机删除，不可恢复。"
            heading="确认删除整个项目？"
            onClose={() => setDeleteProjectConfirmOpen(false)}
            onConfirm={() => {
              setDeleteProjectConfirmOpen(false);
              void deleteProject(activeProject.projectId);
            }}
            open
            title="删除项目"
          />
        ) : null}

        {activeProject && stage !== "output" ? (
          <button className="production-entry-switch" onClick={startNewProduction} type="button">
            <Icon name="sparkle" size={19} />
            <span>再做一条</span>
            <small>换一种做法</small>
          </button>
        ) : null}

        {showHistory ? (
          <ProductionHistoryList
            activeProjectId={project?.projectId}
            composingNew={composingNew}
            onSelect={(item) => {
              if (!composingNew && item.projectId === project?.projectId) return;
              contextGenerationRef.current += 1;
              setProgress(0);
              setProgressMessage("");
              setComposingNew(false);
              setProject(item);
            }}
            projects={projects}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
