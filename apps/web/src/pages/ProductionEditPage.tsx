import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SUBTITLE_TEMPLATE_ID, issueFromAppError, isSubtitleTemplateId } from "@hongtai/core";
import type { AppRuntime, ProductionProjectRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { ProductionShotEditCard } from "../components/ProductionShotEditCard";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { StepperField } from "../components/StepperField";
import { SubtitleTemplatePicker } from "../components/SubtitleTemplatePicker";
import {
  buildPlanUpdate,
  draftTotalMilliseconds,
  planDraftFrom,
  redistributeShotDuration,
  shortCueCount,
  type PlanDraft,
} from "../features/production/plan-edit-model";
import { readProductionPlan } from "../features/production/production-plan-view";
import { pathForRoute, type Navigate } from "../router";

export interface ProductionEditPageProps {
  readonly projectId: string;
  readonly navigate: Navigate;
  readonly runtime: AppRuntime;
}

/** The tuning screen only edits a plan that is already finished and not being written to. */
function editableStatus(project: ProductionProjectRecord): boolean {
  return project.status !== "planning" && project.status !== "rendering";
}

export function ProductionEditPage({ projectId, navigate, runtime }: ProductionEditPageProps) {
  const [project, setProject] = useState<ProductionProjectRecord>();
  const [draft, setDraft] = useState<PlanDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<TaskIssue>();
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);

  const adopt = useCallback((next: ProductionProjectRecord) => {
    setProject(next);
    setDraft(planDraftFrom(readProductionPlan(next.plan)));
    setStale(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await runtime.production.get(projectId);
      if (!next) {
        setProject(undefined);
        return;
      }
      adopt(next);
      setIssue(undefined);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "这个制作项目暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [adopt, projectId, runtime]);

  useEffect(() => { void load(); }, [load]);

  // A render finishing elsewhere, or an edit from another screen, replaces the record. Adopting the
  // new version keeps this screen's token current instead of letting it become the stale writer.
  useEffect(() => {
    try {
      return runtime.production.subscribe(projectId, (event) => {
        if (event.type !== "state" || event.project.projectId !== projectId) return;
        setProject((current) => {
          if (current && current.updatedAt === event.project.updatedAt) return current;
          setStale(Boolean(current));
          return event.project;
        });
      });
    } catch {
      return undefined;
    }
  }, [projectId, runtime]);

  const plan = readProductionPlan(project?.plan);
  const total = draft ? draftTotalMilliseconds(draft.shots) : 0;
  const avatarMode = project?.mode === "avatar";
  const busy = saving || !project || !editableStatus(project);
  const update = draft && project ? buildPlanUpdate({ draft, plan, expectedUpdatedAt: project.updatedAt }) : undefined;

  const patch = (next: PlanDraft) => {
    setDraft(next);
    setSaved(false);
  };

  const save = async () => {
    if (!update || !project) return;
    setSaving(true);
    setIssue(undefined);
    try {
      adopt(await runtime.production.updatePlan(projectId, update));
      setSaved(true);
    } catch (error) {
      const next = issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "这次微调没有保存成功", action: "retry" });
      // A stale token means someone else already wrote. Retrying blind would either overwrite that
      // work or, worse, fall through to the generic retry path and start a local render.
      if (next.code === "PRODUCTION_PLAN_VERSION_STALE") {
        setStale(true);
        setIssue(next);
        await load();
      } else {
        setIssue(next);
      }
    } finally {
      setSaving(false);
    }
  };

  const back = () => navigate(pathForRoute("create"));

  if (loading) {
    return (
      <AppShell activeNav="create" backPath={pathForRoute("create")} headerMode="detail" navigate={navigate} title="微调导出">
        <LoadingState title="正在打开微调" />
      </AppShell>
    );
  }

  if (!project || !draft) {
    return (
      <AppShell activeNav="create" backPath={pathForRoute("create")} headerMode="detail" navigate={navigate} title="微调导出">
        <EmptyState action={<Button onClick={back}>回到制作</Button>} description="这个制作项目已经不在本机了，请返回制作页重新选择。" icon="movie_edit" title="找不到这个项目" />
        {issue ? <IssueNotice issue={issue} /> : null}
      </AppShell>
    );
  }

  if (!plan.editable) {
    return (
      <AppShell activeNav="create" backPath={pathForRoute("create")} headerMode="detail" navigate={navigate} subtitle={project.brief} title="微调导出">
        <EmptyState
          action={<Button onClick={back}>回到制作</Button>}
          description={plan.schemaVersion === "production-plan.v1"
            ? "这个制作计划是旧版本，没有可微调的字幕和文字层。请回到制作页重新生成计划。"
            : "还没有可微调的制作计划。请先在制作页生成计划。"}
          icon="tune"
          title="暂时不能微调"
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      activeNav="create"
      backPath={pathForRoute("create")}
      className="production-edit-page"
      contextualAction={(
        <Button disabled={busy || !update} onClick={save} size="lg">
          {saving ? "正在保存微调" : update ? "保存微调" : saved ? "已保存" : "还没有改动"}
        </Button>
      )}
      headerMode="detail"
      navigate={navigate}
      subtitle={`共 ${plan.shots.length} 个镜头 · ${(total / 1_000).toFixed(1)} 秒`}
      title="微调导出"
    >
      {/* The stale code carries `retry`, which the workbench maps to "render". Here retry has to
          mean "read the newer plan", or one tap would start a local composition instead. */}
      {issue ? <IssueNotice actions={{ retry: issue.code === "PRODUCTION_PLAN_VERSION_STALE" ? load : save }} issue={issue} /> : null}

      {stale ? (
        <aside className="production-edit-stale" role="alert">
          <strong>这个计划刚刚在别处被改过</strong>
          <p>页面已经换成最新的计划，之前没保存的改动没有写进去。请确认后重新调整。</p>
        </aside>
      ) : null}

      {project.output ? (
        <p className="production-hint">
          <Icon name="info" size={16} />
          已经有一条合成好的成片。保存微调会把它作废，需要回到制作页重新合成。
        </p>
      ) : null}

      {!editableStatus(project) ? (
        <p className="production-hint" role="status">
          <Icon name="pending" size={16} />
          这个项目正在处理中，等它结束后才能保存微调。
        </p>
      ) : null}

      <GlassCard className="production-edit-global">
        <h2>字幕模板</h2>
        <p className="production-edit-global__note">
          {plan.subtitle?.degraded
            ? "你选的模板需要逐字时间，这条视频还没有，所以会按降级后的模板烧录。"
            : "选中的模板决定字幕的字号、描边和出场方式，导出时逐帧烧录进画面。"}
        </p>
        <SubtitleTemplatePicker
          disabled={busy}
          hasWordTiming={plan.subtitle?.precision === "word"}
          onChange={(templateId) => patch({ ...draft, subtitleTemplateId: templateId })}
          // Plans made before subtitle templates existed carry no choice; the service resolves that
          // to the default, so showing the default is what will actually burn in.
          value={isSubtitleTemplateId(draft.subtitleTemplateId) ? draft.subtitleTemplateId : DEFAULT_SUBTITLE_TEMPLATE_ID}
        />

        <h2>整条视频</h2>
        <div className="production-edit-global__field">
          <label className="field-label" htmlFor="production-edit-headline">主文字</label>
          <input
            disabled={busy}
            id="production-edit-headline"
            maxLength={24}
            onChange={(event) => patch({ ...draft, headlineText: event.target.value })}
            type="text"
            value={draft.headlineText}
          />
        </div>

        <StepperField
          disabled={busy || avatarMode}
          format={(value) => `${value.toFixed(2)} 倍`}
          hint={avatarMode ? "数字人用的是视频原声，语速由原视频决定。" : "只影响本地生成的旁白语速，不改字幕文字。"}
          label="旁白语速"
          max={1.25}
          min={0.75}
          onChange={(value) => patch({ ...draft, speechRate: Number(value.toFixed(2)) })}
          step={0.05}
          value={draft.speechRate}
        />

        {draft.backgroundMusicAssetId ? (
          <>
            <StepperField
              disabled={busy}
              format={(value) => `${Math.round(value * 100)}%`}
              hint="背景音乐压在旁白下面，太大会盖住人声。"
              label="背景音乐音量"
              max={0.35}
              min={0.05}
              onChange={(value) => patch({ ...draft, backgroundMusicVolume: Number(value.toFixed(2)) })}
              step={0.05}
              value={Math.max(0.05, draft.backgroundMusicVolume)}
            />
            <Button disabled={busy} onClick={() => patch({ ...draft, backgroundMusicAssetId: null, backgroundMusicVolume: 0 })} variant="quiet">
              <Icon name="close" size={16} />不要背景音乐
            </Button>
          </>
        ) : null}
      </GlassCard>

      <div className="production-edit-shots">
        <h2>逐镜微调</h2>
        {draft.shots.map((shot) => {
          const source = plan.shots.find((candidate) => candidate.order === shot.order);
          if (!source) return null;
          return (
            <ProductionShotEditCard
              disabled={busy}
              draft={shot}
              hasWordTiming={plan.subtitle?.precision === "word"}
              key={shot.order}
              lockedCopy={avatarMode}
              onCaption={(value) => patch({ ...draft, shots: draft.shots.map((candidate) => candidate.order === shot.order ? { ...candidate, caption: value } : candidate) })}
              onDuration={(milliseconds) => patch({
                ...draft,
                shots: redistributeShotDuration({
                  shots: draft.shots,
                  order: shot.order,
                  milliseconds,
                  totalMilliseconds: Math.round(plan.targetDurationSeconds * 1_000),
                }),
              })}
              onNarration={(value) => patch({ ...draft, shots: draft.shots.map((candidate) => candidate.order === shot.order ? { ...candidate, narration: value } : candidate) })}
              shortCues={shortCueCount(source)}
              shot={source}
              shots={draft.shots}
              templateId={plan.subtitle?.templateId ?? ""}
              totalMilliseconds={Math.round(plan.targetDurationSeconds * 1_000)}
            />
          );
        })}
      </div>

      <p className="production-edit-footnote">
        字幕的进出点按文案和模板重新推算，来源是文字长度而不是真实语音，所以只是接近而非逐字对齐。镜头的数量、顺序和画面比例在这里不能改。
      </p>
    </AppShell>
  );
}
