import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ProductionMode, ProductionProjectRecord, ProductionTextPreset, TaskIssue } from "@hongtai/core";

import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { MaterialLibraryHeaderAction } from "../components/MaterialLibraryHeaderAction";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice, issueTitle } from "../components/IssueNotice";
import { ProductionModeEntry, type ProductionEntryKind } from "../components/ProductionModeEntry";
import { ProductionProjectCard } from "../components/ProductionProjectCard";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { platformLabel } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, pathForRoute, productionEditPath, replicaWizardPath } from "../router";
import {
  productionComposerBlockedReason,
  productionPlanBlockedReason,
  productionPlanReady,
  productionPrimaryBlockedReason,
  productionRenderStageCopy,
  productionStatusLabel,
  resolveProductionPrimaryAction,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
} from "./production-workbench-model";
import { consumeCreateSourceIdFromSearch, isEligibleCreateSourceTask, peekCreateSourceIdFromSearch, resolveCreateWorkbenchEntry } from "./task-page-model";

export { productionRenderStageCopy };

type CreateShellViewModel = Pick<CreateViewModel, "title">;
type ComposerFlow = "pick" | ProductionEntryKind;

export interface CreatePageProps {
  readonly viewModel?: CreateShellViewModel;
  readonly navigate: (path: string) => void;
  readonly runtime?: AppRuntime;
}

interface AnalysisSource {
  readonly task: AppTaskRecord;
  readonly label: string;
}

export function CreatePage({ viewModel, navigate, runtime }: CreatePageProps) {
  if (!runtime) return <PlannedCreatePage navigate={navigate} title={viewModel?.title} />;
  return <ProductionWorkbenchPage navigate={navigate} runtime={runtime} />;
}

function focusProductionInput(): void {
  if (typeof document === "undefined") return;
  const brief = document.getElementById("production-brief");
  const script = document.getElementById("production-avatar-script");
  (brief ?? script)?.focus();
}

function PlannedCreatePage({ navigate, title = "制作" }: { readonly navigate: (path: string) => void; readonly title?: string }) {
  return (
    <AppShell activeNav="create" headerAction={<MaterialLibraryHeaderAction />} leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={25} /></span>} navigate={navigate} title={title}>
      <div className="page-stack page-create" data-feature-capability="planned">
        <FeatureUnavailablePanel feature="create" />
        <GlassCard className="planned-workbench">
          <strong>制作工作台</strong>
          <textarea disabled placeholder="本预览不执行真实制作" rows={4} />
          <Button disabled variant="secondary">尚未接入预览数据</Button>
        </GlassCard>
      </div>
    </AppShell>
  );
}

function ProductionWorkbenchPage({ runtime, navigate }: { readonly runtime: AppRuntime; readonly navigate: (path: string) => void }) {
  const [sources, setSources] = useState<readonly AnalysisSource[]>([]);
  const [projects, setProjects] = useState<readonly ProductionProjectRecord[]>([]);
  const [project, setProject] = useState<ProductionProjectRecord>();
  const [composingNew, setComposingNew] = useState(false);
  const [composerFlow, setComposerFlow] = useState<ComposerFlow>("pick");
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<ProductionMode>("montage");
  const [avatarScript, setAvatarScript] = useState("");
  const [headlineText, setHeadlineText] = useState("");
  const [textPreset, setTextPreset] = useState<ProductionTextPreset>("classic_top");
  const [duration, setDuration] = useState(30);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();
  const composingNewRef = useRef(composingNew);
  composingNewRef.current = composingNew;

  const load = useCallback(async () => {
    const requestedSourceId = peekCreateSourceIdFromSearch();
    try {
      const [succeededTasks, degradedTasks, savedProjects] = await Promise.all([
        runtime.tasks.list({ status: "succeeded", limit: 20 }),
        runtime.tasks.list({ status: "degraded", limit: 20 }),
        runtime.production.list(),
      ]);
      const tasks = [...succeededTasks, ...degradedTasks].filter((task) => isEligibleCreateSourceTask(task.status));
      const records = await Promise.all(tasks.map(async (task) => ({ task, analysis: await runtime.analysis.get(task.id) })));
      const available = records.filter(({ analysis }) => analysis?.status === "succeeded" && analysis.result?.schemaVersion === "content-analysis.v1")
        .map(({ task }) => ({ task, label: sourceCardLabel(task) }));
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
      } else {
        setSourceId((current) => resolveCreateWorkbenchEntry({
          requestedSourceId: "",
          availableSourceIds,
          currentSourceId: current,
          composingNew: composingNewRef.current,
        }).sourceId);
        setIssue(undefined);
      }
      setProject((current) => current
        ? savedProjects.find((candidate) => candidate.projectId === current.projectId) ?? savedProjects[0]
        : savedProjects[0]);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地制作数据暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

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
  useEffect(() => {
    const projectId = project?.projectId;
    setProgress(0);
    setProgressMessage("");
    if (!projectId || composingNew) return undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = runtime.production.subscribe(projectId, (event) => {
        if (!active) return;
        if (event.type === "state") {
          if (event.project.projectId !== projectId) return;
          setProject(event.project);
          return;
        }
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
  }, [composingNew, project?.projectId, runtime.production]);

  const perform = async (action: () => Promise<ProductionProjectRecord>) => {
    setBusy(true);
    setIssue(undefined);
    try {
      const next = await action();
      setComposingNew(false);
      setProject(next);
      setProjects(await runtime.production.list());
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "本地制作操作没有完成", action: "retry" }));
      const remaining = await runtime.production.list();
      setProjects(remaining);
      setProject((current) => current
        ? remaining.find((candidate) => candidate.projectId === current.projectId) ?? current
        : remaining[0]);
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    if (!sourceId || !brief.trim() || mode === "avatar" && !avatarScript.trim()) {
      const message = mode === "avatar" ? "请选择拆解来源，填写制作需求和数字人口播稿" : "请选择拆解来源并填写制作需求";
      setIssue(issueFromAppError(new TaskError({ code: "INPUT_EMPTY", message, action: "edit_input" }), { code: "INPUT_EMPTY", message: "制作输入不完整", action: "edit_input" }));
      return;
    }
    await perform(() => runtime.production.create({
      analysisTaskId: sourceId,
      brief,
      targetDurationSeconds: duration,
      mode,
      headlineText: headlineText || undefined,
      textPreset,
      ...(mode === "avatar" ? { avatarScript } : {}),
    }));
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
      if (remaining.length === 0) setComposerFlow("pick");
      setProgress(0);
      setProgressMessage("");
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "制作项目没有删除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const activeProject = composingNew ? undefined : project;
  const planReady = activeProject ? productionPlanReady(activeProject) : false;
  const avatarMode = activeProject?.mode === "avatar";
  const usableVisualAssets = activeProject
    ? activeProject.assets.filter((asset) => avatarMode ? asset.role === "avatar" : asset.role === "visual").length
    : 0;
  const importBlocked = Boolean(activeProject && (activeProject.assets.length >= 12 || avatarMode && usableVisualAssets >= 1));
  const primary = resolveProductionPrimaryAction({
    composingNew,
    project: activeProject,
    busy,
    planReady,
    importBlocked,
  });
  const createBlocked = busy || !sourceId || !brief.trim() || (mode === "avatar" && !avatarScript.trim());
  const showComposer = !activeProject;
  const replicaComposer = showComposer && composerFlow === "replica";
  const agentComposer = showComposer && composerFlow === "agent";
  const primaryDisabled = replicaComposer
    ? busy || !sourceId
    : primary.stage === "no-project" ? createBlocked : primary.disabled;
  const planBlockedReason = activeProject ? productionPlanBlockedReason(activeProject) : "";
  const primaryBlockedReason = replicaComposer || primary.stage === "no-project"
    ? productionComposerBlockedReason({ replica: replicaComposer, sourceId, brief, avatarMode: mode === "avatar", avatarScript })
    : productionPrimaryBlockedReason({
      stage: primary.stage,
      busy,
      planReady,
      importBlocked,
      planBlockedReason,
    });
  const composerPrimaryVisible = (agentComposer || replicaComposer) && sources.length > 0;
  const showHistory = projects.length > 1 || composingNew && projects.length > 0;

  const enterComposer = (flow: ComposerFlow) => {
    // A leftover Agent create failure must not follow the user onto the picker or into 复刻 —
    // retry on those screens would either rebuild the abandoned project or jump into the wizard.
    setIssue(undefined);
    if (flow !== "agent") setMode("montage");
    if (flow === "replica") setSourceId((current) => current || sources[0]?.task.id || "");
    setComposerFlow(flow);
  };

  const startNewProduction = () => {
    setComposingNew(true);
    setIssue(undefined);
    setMode("montage");
    setBrief("");
    setHeadlineText("");
    setAvatarScript("");
    setComposerFlow("pick");
    setProgress(0);
    setProgressMessage("");
  };

  const retryCurrent = () => {
    if (!activeProject) {
      if (composerFlow === "pick") return;
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
    else if (operation === "generate-plan") void perform(() => runtime.production.generatePlan(activeProject.projectId));
    else void perform(() => runtime.production.importAssets(activeProject.projectId));
  };

  const runPrimary = () => {
    if (showComposer && composerFlow === "replica") {
      if (sourceId) navigate(replicaWizardPath(sourceId));
      return;
    }
    if (primary.stage === "no-project") {
      void createProject();
      return;
    }
    if (!activeProject) return;
    if (primary.stage === "no-assets") {
      void perform(() => runtime.production.importAssets(activeProject.projectId));
      return;
    }
    if (primary.stage === "no-plan") {
      void perform(() => runtime.production.generatePlan(activeProject.projectId));
      return;
    }
    if (primary.stage === "no-output") {
      void perform(() => runtime.production.render(activeProject.projectId));
      return;
    }
    if (primary.stage === "has-output") {
      startNewProduction();
      return;
    }
    if (primary.stage === "failed") retryCurrent();
  };

  const issueActions = {
    configureAi: () => navigate(aiSettingsPath()),
    selectMedia: activeProject ? () => void perform(() => runtime.production.importAssets(activeProject.projectId)) : undefined,
    editInput: focusProductionInput,
    retry: () => retryCurrent(),
  };

  const primaryIcon: IconName = replicaComposer
    ? "list"
    : primary.stage === "no-assets" || primary.stage === "failed" && resolveProductionRetryKind(activeProject?.issue?.action ?? issue?.action) === "import"
      ? "upload_file"
      : primary.stage === "no-plan"
        ? "auto_awesome"
        : primary.stage === "no-output"
          ? "bolt"
          : primary.stage === "rendering"
            ? "sync"
            : primary.stage === "has-output"
              ? "sparkle"
              : "movie_edit";

  const primaryLabel = replicaComposer
    ? "按清单复刻"
    : primary.stage === "rendering" ? `${progressMessage || primary.label} ${progress}%` : primary.label;

  const contextualAction = !showComposer || composerPrimaryVisible
    ? (
      <div className="contextual-action-stack">
        {primaryBlockedReason ? <p className="contextual-action-hint" id="production-primary-blocked-reason">{primaryBlockedReason}</p> : null}
        <Button aria-describedby={primaryBlockedReason ? "production-primary-blocked-reason" : undefined} className={busy || primary.stage === "rendering" ? "is-busy" : ""} disabled={primaryDisabled} icon={<Icon name={primaryIcon} size={19} />} onClick={runPrimary} size="lg">
          {primaryLabel}
        </Button>
      </div>
    )
    : undefined;

  if (loading) return <AppShell activeNav="create" headerAction={<MaterialLibraryHeaderAction />} navigate={navigate} title="制作"><LoadingState description="正在读取正式拆解与本地制作项目" title="打开制作工作台" /></AppShell>;

  return (
    <AppShell activeNav="create" contextualAction={contextualAction} headerAction={<MaterialLibraryHeaderAction />} leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={24} /></span>} navigate={navigate} title="制作">
      <div className="page-stack page-create production-workbench" data-composer-flow={showComposer ? composerFlow : "project"} data-production-stage={primary.stage}>
        {issue && !(showComposer && issue.action === "none") ? <IssueNotice actions={issueActions} issue={issue} /> : null}
        {issue && showComposer && issue.action === "none" ? (
          <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
            <strong>{issueTitle(issue)}</strong>
            <small>{issue.userMessage}</small>
          </aside>
        ) : null}

        {showComposer ? (
          composerFlow === "pick" ? (
            <>
              <section className="production-hero">
                <h2>这次走哪条路？</h2>
                <p>先选一种做法。两条路要准备的东西不一样。</p>
              </section>
              <ProductionModeEntry onSelect={enterComposer} />
            </>
          ) : (
            <>
              <button className="production-entry-switch" onClick={() => enterComposer("pick")} type="button">
                <Icon name={composerFlow === "agent" ? "movie_edit" : "list"} size={19} />
                <span>{composerFlow === "agent" ? "Agent 模式" : "爆款复刻"}</span>
                <small>更换</small>
              </button>
              {composerFlow === "agent" ? (
                <AgentSetupForm
                  avatarScript={avatarScript}
                  brief={brief}
                  duration={duration}
                  headlineText={headlineText}
                  mode={mode}
                  onAvatarScript={setAvatarScript}
                  onBrief={setBrief}
                  onDuration={setDuration}
                  onGoAnalyze={() => navigate(pathForRoute("home"))}
                  onHeadlineText={setHeadlineText}
                  onMode={setMode}
                  onSourceId={setSourceId}
                  onTextPreset={setTextPreset}
                  sourceId={sourceId}
                  sources={sources}
                  textPreset={textPreset}
                />
              ) : (
                <ReplicaSetupForm
                  onGoAnalyze={() => navigate(pathForRoute("home"))}
                  onSourceId={setSourceId}
                  sourceId={sourceId}
                  sources={sources}
                />
              )}
            </>
          )
        ) : activeProject ? (
          <ProductionProjectCard
            busy={busy}
            onConfigureAi={() => navigate(aiSettingsPath())}
            onDeleteProject={() => void deleteProject(activeProject.projectId)}
            onEditPlan={() => navigate(productionEditPath(activeProject.projectId))}
            onGeneratePlan={() => void perform(() => runtime.production.generatePlan(activeProject.projectId))}
            onImport={() => void perform(() => runtime.production.importAssets(activeProject.projectId))}
            onRemoveAsset={(assetId) => void perform(() => runtime.production.removeAsset(activeProject.projectId, assetId))}
            onRemoveOutput={() => void perform(() => runtime.production.removeOutput(activeProject.projectId))}
            pageIssue={issue}
            progress={progress}
            progressMessage={progressMessage}
            project={activeProject}
          />
        ) : null}

        {activeProject && primary.stage !== "has-output" ? (
          <button className="production-entry-switch" onClick={startNewProduction} type="button">
            <Icon name="sparkle" size={19} />
            <span>再做一条</span>
            <small>换一种做法</small>
          </button>
        ) : null}

        {showHistory ? (
          <section className="production-history">
            <h3>本地制作记录</h3>
            <div>{projects.map((item) => <button className={!composingNew && item.projectId === project?.projectId ? "is-active" : ""} key={item.projectId} onClick={() => { if (!composingNew && item.projectId === project?.projectId) return; setProgress(0); setProgressMessage(""); setComposingNew(false); setProject(item); }} type="button"><span>{item.brief}</span><small>{productionStatusLabel(item.status)}</small></button>)}</div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function sourceCardLabel(task: AppTaskRecord): string {
  const platform = task.sourceKind === "local_video" ? "本地上传" : platformLabel(task.platform) ?? "内容任务";
  return `${platform} · ${new Date(task.updatedAt).toLocaleDateString("zh-CN")}`;
}

function SourcePicker({
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
        {sources.map(({ task, label }) => (
          <button aria-selected={task.id === sourceId} className={task.id === sourceId ? "production-source-card is-selected" : "production-source-card"} key={task.id} onClick={() => onSourceId(task.id)} role="option" type="button">
            <strong>{label}</strong>
          </button>
        ))}
      </div>
    </>
  );
}

function AgentSetupForm({
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
            <label className="field-label" htmlFor="production-brief">{avatarOn ? "视频标题与制作需求" : "你的经营需求"}</label>
            <textarea id="production-brief" maxLength={500} onChange={(event) => onBrief(event.target.value)} placeholder={avatarOn ? "例如：介绍门店的新服务，语气自然可信，不夸大承诺。" : "例如：面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。"} rows={4} value={brief} />
            <small className="production-field-help">{brief.length}/500</small>
            <SourcePicker onSourceId={onSourceId} sourceId={sourceId} sources={sources} />
            <span className="field-label" id="production-avatar-option-label">也可以改用数字人口播</span>
            <button aria-describedby="production-avatar-option-label" aria-pressed={mode === "avatar"} className={mode === "avatar" ? "production-avatar-option is-selected" : "production-avatar-option"} onClick={() => onMode(avatarOn ? "montage" : "avatar")} type="button">
              <Icon name="record_voice_over" size={19} />
              <span>
                <strong>数字人口播</strong>
                <small>改用已录好原声的 MP4，只烧字幕、不配音</small>
              </span>
            </button>
            <label className="field-label" htmlFor="production-headline">主文字（可选）</label>
            <input id="production-headline" maxLength={24} onChange={(event) => onHeadlineText(event.target.value)} placeholder="例如：你出时间，我出货" value={headlineText} />
            <small className="production-field-help">留空时由 AI 根据你的真实需求生成；填写后成片会逐字使用。</small>
            <label className="field-label" htmlFor="production-text-preset">文字预设</label>
            <select id="production-text-preset" onChange={(event) => onTextPreset(event.target.value as ProductionTextPreset)} value={textPreset}>
              <option value="classic_top">经典顶部白字</option>
              <option value="clean_card">简洁白底卡片</option>
              <option value="aqua_accent">青绿色强调</option>
            </select>
            {avatarOn ? (
              <>
                <label className="field-label" htmlFor="production-avatar-script">数字人口播稿</label>
                <textarea id="production-avatar-script" maxLength={360} onChange={(event) => onAvatarScript(event.target.value)} placeholder="请粘贴与上传数字人视频原声一致的口播稿。它会在本地切分为短字幕，不会替换原视频声音。" rows={5} value={avatarScript} />
              </>
            ) : null}
            <label className="field-label" htmlFor="production-duration">目标时长</label>
            <select id="production-duration" onChange={(event) => onDuration(Number(event.target.value))} value={duration}>
              {[15, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
            </select>
            {avatarOn ? <small className="production-field-help">口播视频时长不能短于这个目标。旁白语速和单镜时长之后也不能改。</small> : null}
          </>
        ) : (
          <EmptyState
            action={<Button onClick={onGoAnalyze}>去拆解一条</Button>}
            description="先完成一个采集任务，并在任务详情中手动运行 AI 自动拆解。"
            icon="analytics"
            title="还没有可用于制作的拆解"
          />
        )}
      </GlassCard>
    </>
  );
}

function ReplicaSetupForm({
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
            description="爆款复刻必须先有一份成功的正式拆解。先完成采集，再在任务详情里运行 AI 自动拆解。"
            icon="analytics"
            title="还没有可用于复刻的拆解"
          />
        )}
      </GlassCard>
    </>
  );
}
