import { useCallback, useEffect, useState } from "react";
import { issueFromAppError, TaskError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ProductionMode, ProductionProjectRecord, TaskIssue } from "@hongtai/core";

import type { CreateViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { FeatureUnavailablePanel } from "../components/FeatureUnavailablePanel";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { ProductionProjectCard } from "../components/ProductionProjectCard";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { aiSettingsPath } from "../router";

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

function PlannedCreatePage({ navigate, title = "制作" }: { readonly navigate: (path: string) => void; readonly title?: string }) {
  return (
    <AppShell activeNav="create" leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={25} /></span>} navigate={navigate} title={title}>
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
  const [sourceId, setSourceId] = useState("");
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<ProductionMode>("montage");
  const [avatarScript, setAvatarScript] = useState("");
  const [duration, setDuration] = useState(30);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<TaskIssue>();

  const load = useCallback(async () => {
    try {
      const [tasks, savedProjects] = await Promise.all([
        runtime.tasks.list({ status: "succeeded", limit: 20 }),
        runtime.production.list(),
      ]);
      const records = await Promise.all(tasks.map(async (task) => ({ task, analysis: await runtime.analysis.get(task.id) })));
      const available = records.filter(({ analysis }) => analysis?.status === "succeeded" && analysis.result?.schemaVersion === "content-analysis.v1")
        .map(({ task }) => ({ task, label: `${platformName(task.platform, task.sourceKind)} · ${new Date(task.updatedAt).toLocaleDateString("zh-CN")}` }));
      setSources(available);
      setProjects(savedProjects);
      setSourceId((current) => current || available[0]?.task.id || "");
      setProject((current) => current ?? savedProjects[0]);
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地制作数据暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!project) return undefined;
    return runtime.production.subscribe(project.projectId, (event) => {
      if (event.type === "state") setProject(event.project);
      else { setProgress(event.progress); setProgressMessage(event.message); }
    });
  }, [project?.projectId, runtime.production]);

  const perform = async (action: () => Promise<ProductionProjectRecord>) => {
    setBusy(true);
    setIssue(undefined);
    try {
      const next = await action();
      setProject(next);
      setProjects(await runtime.production.list());
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "本地制作操作没有完成", action: "retry" }));
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
      setProgress(0);
      setProgressMessage("");
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "制作项目没有删除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AppShell activeNav="create" navigate={navigate} title="制作"><LoadingState description="正在读取正式拆解与本地制作项目" title="打开制作工作台" /></AppShell>;

  return (
    <AppShell activeNav="create" leadingAction={<span className="page-header-icon"><Icon name="movie_edit" size={24} /></span>} navigate={navigate} title="制作">
      <div className="page-stack page-create production-workbench">
        {issue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), selectMedia: project ? () => void perform(() => runtime.production.importAssets(project.projectId)) : undefined }} issue={issue} /> : null}

        <section className="production-hero">
          <span className="eyebrow">LOCAL VIDEO STUDIO</span>
          <h2>从爆款结构到你的本地成片</h2>
          <p>复用 content-analysis.v1 的结构方法，生成 production-plan.v1；只使用你主动上传的素材，并在手机本地合成。素材剪辑模式会使用 AI 连接页配置的 TTS 配音与字幕；数字人口播保留原视频声音。</p>
        </section>

        <GlassCard className="production-setup">
          <div className="production-section-title"><span>01</span><div><strong>确定内容方向</strong><small>来源必须已有正式拆解结果</small></div></div>
          {sources.length > 0 ? (
            <>
              <label className="field-label" htmlFor="production-source">爆款拆解来源</label>
              <select id="production-source" onChange={(event) => setSourceId(event.target.value)} value={sourceId}>
                {sources.map(({ task, label }) => <option key={task.id} value={task.id}>{label}</option>)}
              </select>
              <span className="field-label">制作方式</span>
              <div aria-label="制作方式" className="production-mode-grid" role="group">
                <button aria-pressed={mode === "montage"} className={mode === "montage" ? "is-selected" : ""} onClick={() => setMode("montage")} type="button"><Icon name="movie_edit" size={19} /><span><strong>素材剪辑 + TTS</strong><small>上传图片或视频，使用 AI 连接页配置的 TTS 配音并生成字幕</small></span></button>
                <button aria-pressed={mode === "avatar"} className={mode === "avatar" ? "is-selected" : ""} onClick={() => setMode("avatar")} type="button"><Icon name="record_voice_over" size={19} /><span><strong>数字人口播</strong><small>上传带原声的数字人 MP4，本地按口播稿生成字幕</small></span></button>
              </div>
              <label className="field-label" htmlFor="production-brief">{mode === "avatar" ? "视频标题与制作需求" : "你的经营需求"}</label>
              <textarea id="production-brief" onChange={(event) => setBrief(event.target.value)} placeholder={mode === "avatar" ? "例如：介绍门店的新服务，语气自然可信，不夸大承诺。" : "例如：面向附近上班族，突出真实环境、服务过程和到店体验，不夸大承诺。"} rows={4} value={brief} />
              {mode === "avatar" ? <><label className="field-label" htmlFor="production-avatar-script">数字人口播稿</label><textarea id="production-avatar-script" maxLength={360} onChange={(event) => setAvatarScript(event.target.value)} placeholder="请粘贴与上传数字人视频原声一致的口播稿。它会在本地切分为短字幕，不会替换原视频声音。" rows={5} value={avatarScript} /></> : null}
              <label className="field-label" htmlFor="production-duration">目标时长</label>
              <select id="production-duration" onChange={(event) => setDuration(Number(event.target.value))} value={duration}>
                {[15, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
              </select>
              <Button disabled={busy} icon={<Icon name="sparkle" size={18} />} onClick={() => void createProject()}>新建制作项目</Button>
            </>
          ) : <EmptyState description="先完成一个采集任务，并在任务详情中手动运行 AI 自动拆解。" icon="analytics" title="还没有可用于制作的拆解" />}
        </GlassCard>

        {project ? (
          <ProductionProjectCard
            busy={busy}
            onGeneratePlan={() => void perform(() => runtime.production.generatePlan(project.projectId))}
            onImport={() => void perform(() => runtime.production.importAssets(project.projectId))}
            onDeleteProject={() => void deleteProject(project.projectId)}
            onRemoveAsset={(assetId) => void perform(() => runtime.production.removeAsset(project.projectId, assetId))}
            onRemoveOutput={() => void perform(() => runtime.production.removeOutput(project.projectId))}
            onRender={() => void perform(() => runtime.production.render(project.projectId))}
            progress={progress}
            progressMessage={progressMessage}
            project={project}
          />
        ) : null}

        {projects.length > 1 ? (
          <section className="production-history">
            <h3>本地制作记录</h3>
            <div>{projects.map((item) => <button className={item.projectId === project?.projectId ? "is-active" : ""} key={item.projectId} onClick={() => setProject(item)} type="button"><span>{item.brief}</span><small>{statusLabel(item.status)}</small></button>)}</div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function platformName(platform: AppTaskRecord["platform"], sourceKind: AppTaskRecord["sourceKind"]): string {
  if (sourceKind === "local_video") return "本地上传";
  return platform ? ({ douyin: "抖音", xiaohongshu: "小红书", bilibili: "B站", kuaishou: "快手" } as const)[platform] : "内容任务";
}

function statusLabel(status: ProductionProjectRecord["status"]): string {
  return ({ draft: "待准备", planning: "规划中", ready: "计划就绪", rendering: "合成中", succeeded: "已完成", failed: "未完成" } as const)[status];
}
