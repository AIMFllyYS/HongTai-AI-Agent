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
import { ProductionProjectCard } from "../components/ProductionProjectCard";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { platformLabel } from "../features/tasks/task-presenters";
import { useAppResume } from "../hooks/useAppResume";
import { aiSettingsPath, productionEditPath } from "../router";
import {
  productionPlanReady,
  productionRenderStageCopy,
  productionStatusLabel,
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

  useAppResume(load);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading) return undefined;
    let active = true;
    const consumeRecovery = async () => {
      try {
        const recovered = await runtime.production.consumeAssetRecovery();
        if (!active) return;
        if (recovered.status === "succeeded") {
          setBusy(true);
          setComposingNew(false);
          setProject(recovered.project);
          setProjects(await runtime.production.list());
        }
        if (recovered.status === "failed") setIssue(recovered.issue);
      } catch (error) {
        if (active) {
          setIssue(issueFromAppError(error, { code: "TASK_INTERRUPTED", message: "素材选择恢复失败，请重新选择", action: "select_media" }));
        }
      } finally {
        if (active) setBusy(false);
      }
    };
    void consumeRecovery();
    return () => { active = false; };
  }, [loading, runtime]);
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
  const primaryDisabled = primary.stage === "no-project" ? createBlocked : primary.disabled;
  const showComposer = !activeProject;
  const showHistory = projects.length > 1 || composingNew && projects.length > 0;

  const retryCurrent = () => {
    if (!activeProject) {
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
      setComposingNew(true);
      setBrief("");
      setHeadlineText("");
      setAvatarScript("");
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

  const primaryIcon: IconName = primary.stage === "no-assets" || primary.stage === "failed" && resolveProductionRetryKind(activeProject?.issue?.action ?? issue?.action) === "import"
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

  const contextualAction = sources.length === 0 && showComposer
    ? undefined
    : (
      <Button className={busy || primary.stage === "rendering" ? "is-busy" : ""} disabled={primaryDisabled} icon={<Icon name={primaryIcon} size={19} />} onClick={runPrimary} size="lg">
        {primary.stage === "rendering" ? `${progressMessage || primary.label} ${progress}%` : primary.label}
      </Button>
    );

  if (loading) return <AppShell activeNav="create" headerAction={<MaterialLibraryHeaderAction />} navigate={navigate} title="制作"><LoadingState description="正在读取正式拆解与本地制作项目" title="打开制作工作台" /></AppShell>;

  return (
    <AppShell activeNav="create" contextualAction={contextualAction} headerAction={<MaterialLibraryHeaderAction />} leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={24} /></span>} navigate={navigate} title="制作">
      <div className="page-stack page-create production-workbench" data-production-stage={primary.stage}>
        {issue ? <IssueNotice actions={issueActions} issue={issue} /> : null}
        {issue && issue.action !== "edit_input" && showComposer ? (
          <aside className={`issue-notice issue-notice--${issue.severity}`} role={issue.severity === "error" ? "alert" : "status"}>
            <strong>{issueTitle(issue)}</strong>
            <small>{issue.userMessage}</small>
          </aside>
        ) : null}

        {showComposer ? (
          <>
            <section className="production-hero">
              <h2>这次想讲什么？</h2>
            </section>
            <GlassCard className="production-setup">
              {sources.length > 0 ? (
                <>
                  <label className="field-label" htmlFor="production-brief">{mode === "avatar" ? "视频标题与制作需求" : "你的经营需求"}</label>
                  <textarea id="production-brief" maxLength={500} onChange={(event) => setBrief(event.target.value)} placeholder={mode === "avatar" ? "例如：介绍门店的新服务，语气自然可信，不夸大承诺。" : "例如：面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。"} rows={4} value={brief} />
                  <small className="production-field-help">{brief.length}/500</small>
                  <span className="field-label" id="production-source-label">参考哪条拆解</span>
                  <div aria-labelledby="production-source-label" className="production-source-scroller" role="listbox">
                    {sources.map(({ task, label }) => (
                      <button aria-selected={task.id === sourceId} className={task.id === sourceId ? "production-source-card is-selected" : "production-source-card"} key={task.id} onClick={() => setSourceId(task.id)} role="option" type="button">
                        <strong>{label}</strong>
                      </button>
                    ))}
                  </div>
                  <span className="field-label">制作方式</span>
                  <div aria-label="制作方式" className="production-mode-grid" role="group">
                    <button aria-pressed={mode === "montage"} className={mode === "montage" ? "is-selected" : ""} onClick={() => setMode("montage")} type="button"><Icon name="movie_edit" size={19} /><span><strong>素材剪辑 + TTS</strong><small>上传图片或视频，使用 AI 连接页配置的 TTS 配音并生成字幕</small></span></button>
                    <button aria-pressed={mode === "avatar"} className={mode === "avatar" ? "is-selected" : ""} onClick={() => setMode("avatar")} type="button"><Icon name="record_voice_over" size={19} /><span><strong>数字人口播</strong><small>上传带原声的数字人 MP4，本地按口播稿生成字幕</small></span></button>
                  </div>
                  <label className="field-label" htmlFor="production-headline">主文字（可选）</label>
                  <input id="production-headline" maxLength={24} onChange={(event) => setHeadlineText(event.target.value)} placeholder="例如：你出时间，我出货" value={headlineText} />
                  <small className="production-field-help">留空时由 AI 根据你的真实需求生成；填写后成片会逐字使用。</small>
                  <label className="field-label" htmlFor="production-text-preset">文字预设</label>
                  <select id="production-text-preset" onChange={(event) => setTextPreset(event.target.value as ProductionTextPreset)} value={textPreset}>
                    <option value="classic_top">经典顶部白字</option>
                    <option value="clean_card">简洁白底卡片</option>
                    <option value="aqua_accent">青绿色强调</option>
                  </select>
                  {mode === "avatar" ? <><label className="field-label" htmlFor="production-avatar-script">数字人口播稿</label><textarea id="production-avatar-script" maxLength={360} onChange={(event) => setAvatarScript(event.target.value)} placeholder="请粘贴与上传数字人视频原声一致的口播稿。它会在本地切分为短字幕，不会替换原视频声音。" rows={5} value={avatarScript} /></> : null}
                  <label className="field-label" htmlFor="production-duration">目标时长</label>
                  <select id="production-duration" onChange={(event) => setDuration(Number(event.target.value))} value={duration}>
                    {[15, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
                  </select>
                </>
              ) : <EmptyState description="先完成一个采集任务，并在任务详情中手动运行 AI 自动拆解。" icon="analytics" title="还没有可用于制作的拆解" />}
            </GlassCard>
          </>
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
