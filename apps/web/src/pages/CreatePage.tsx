import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type { AppRuntime, ProductionMode, ProductionProjectRecord, ProductionTextPreset, TaskIssue } from "@hongtai/core";

import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { MaterialLibraryHeaderAction } from "../components/MaterialLibraryHeaderAction";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice, issueTitle } from "../components/IssueNotice";
import { ProductionProjectCard } from "../components/ProductionProjectCard";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { ProductionComposerPanel, type ComposerFlow } from "../features/production/production-composer-panel";
import { ProductionHistoryList } from "../features/production/production-history-list";
import { sourceCardFromTask, type AnalysisSource } from "../features/production/production-setup-forms";
import { readContentAnalysis } from "../features/tasks/content-analysis-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { composeEntryFromSearch, consumeComposeEntryFromSearch } from "../navigation/compose-actions";
import { aiSettingsPath, pathForRoute, productionEditPath, replicaWizardPath } from "../router";
import {
  productionComposerBlockedReason,
  productionPlanBlockedReason,
  productionPlanReady,
  productionPrimaryBlockedReason,
  productionRenderStageCopy,
  resolveProductionPrimaryAction,
  resolveProductionRetryKind,
  resolveProductionRetryOperation,
} from "./production-workbench-model";
import { consumeCreateSourceIdFromSearch, isEligibleCreateSourceTask, peekCreateSourceIdFromSearch, resolveCreateWorkbenchEntry } from "./task-page-model";

export { productionRenderStageCopy };

type CreateShellViewModel = Pick<CreateViewModel, "title">;

export interface CreatePageProps {
  readonly viewModel?: CreateShellViewModel;
  readonly navigate: (path: string) => void;
  readonly runtime?: AppRuntime;
  readonly searchEpoch?: number;
}

export function CreatePage({ viewModel, navigate, runtime, searchEpoch = 0 }: CreatePageProps) {
  if (!runtime) return <PlannedCreatePage navigate={navigate} title={viewModel?.title} />;
  return <ProductionWorkbenchPage navigate={navigate} runtime={runtime} searchEpoch={searchEpoch} />;
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

function shellTitleFor(flow: ComposerFlow, showComposer: boolean): string {
  if (!showComposer) return "制作";
  if (flow === "agent") return "智能成片";
  if (flow === "replica") return "爆款复刻";
  return "制作";
}

function ProductionWorkbenchPage({ runtime, navigate, searchEpoch }: { readonly runtime: AppRuntime; readonly navigate: (path: string) => void; readonly searchEpoch: number }) {
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
      setProject((current) => current
        ? savedProjects.find((candidate) => candidate.projectId === current.projectId) ?? savedProjects[0]
        : savedProjects[0]);
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
  const shellTitle = shellTitleFor(composerFlow, showComposer);

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

  const headerAction = agentComposer || replicaComposer
    ? <button className="production-header-switch" onClick={() => enterComposer("pick")} type="button">更换</button>
    : <MaterialLibraryHeaderAction />;

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
      leadingAction={showComposer && composerFlow !== "pick" ? undefined : <span className="page-header-icon"><Icon name="movie_edit" size={24} /></span>}
      navigate={navigate}
      title={shellTitle}
    >
      <div className="page-stack page-create production-workbench" data-composer-flow={showComposer ? composerFlow : "project"} data-production-stage={primary.stage}>
        {issue && !(showComposer && issue.action === "none") ? <IssueNotice actions={issueActions} issue={issue} /> : null}
        {issue && showComposer && issue.action === "none" ? (
          <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
            <strong>{issueTitle(issue)}</strong>
            <small>{issue.userMessage}</small>
          </aside>
        ) : null}

        {showComposer ? (
          <ProductionComposerPanel
            avatarScript={avatarScript}
            brief={brief}
            duration={duration}
            flow={composerFlow}
            headlineText={headlineText}
            mode={mode}
            onAvatarScript={setAvatarScript}
            onBrief={setBrief}
            onDuration={setDuration}
            onGoAnalyze={() => navigate(pathForRoute("home"))}
            onHeadlineText={setHeadlineText}
            onMode={setMode}
            onSelectEntry={enterComposer}
            onSourceId={setSourceId}
            onTextPreset={setTextPreset}
            sourceId={sourceId}
            sources={sources}
            textPreset={textPreset}
          />
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
          <ProductionHistoryList
            activeProjectId={project?.projectId}
            composingNew={composingNew}
            onSelect={(item) => {
              if (!composingNew && item.projectId === project?.projectId) return;
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
