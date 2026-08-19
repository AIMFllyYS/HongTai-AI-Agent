import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SUBTITLE_TEMPLATE_ID, issueFromAppError, isSubtitleTemplateId } from "@hongtai/core";
import type { AppRuntime, ProductionProjectRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice, isInlineIssueAction, issueTitle } from "../components/IssueNotice";
import { ProductionShotEditCard } from "../components/ProductionShotEditCard";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { StepperField } from "../components/StepperField";
import { SubtitleTemplatePicker } from "../components/SubtitleTemplatePicker";
import {
  buildPlanUpdate,
  draftTotalMilliseconds,
  planDraftFrom,
  planDraftProblem,
  previewShot,
  redistributeShotDuration,
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
  /** The record the draft was read from. Its `updatedAt` is the version token the save must carry. */
  const [base, setBase] = useState<ProductionProjectRecord>();
  /** A newer record seen while the draft had unsaved edits. Saving is blocked until it is resolved. */
  const [conflict, setConflict] = useState<ProductionProjectRecord>();
  const [draft, setDraft] = useState<PlanDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<TaskIssue>();
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  const adopt = useCallback((next: ProductionProjectRecord) => {
    setBase(next);
    setDraft(planDraftFrom(readProductionPlan(next.plan)));
    setConflict(undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await runtime.production.get(projectId);
      if (!next) {
        setBase(undefined);
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

  const plan = readProductionPlan(base?.plan);
  const total = draft ? draftTotalMilliseconds(draft.shots) : 0;
  const avatarMode = base?.mode === "avatar";
  const problem = draft ? planDraftProblem(draft) : undefined;
  const update = draft && base && !problem ? buildPlanUpdate({ draft, plan, expectedUpdatedAt: base.updatedAt }) : undefined;
  const unreadableAssets = (base?.assets ?? []).filter((asset) => asset.reshootAdvice !== undefined);
  const busy = saving || !base || Boolean(conflict) || !editableStatus(base);

  // Read inside the subscription callback, which closes over the state of the render that installed
  // it and must not resubscribe on every keystroke.
  const live = useRef({ updatedAt: "", dirty: false });
  useEffect(() => { live.current = { updatedAt: base?.updatedAt ?? "", dirty: Boolean(update) }; });

  useEffect(() => {
    try {
      return runtime.production.subscribe(projectId, (event) => {
        if (event.type !== "state" || event.project.projectId !== projectId) return;
        const { updatedAt, dirty } = live.current;
        if (!updatedAt || updatedAt === event.project.updatedAt) return;
        // Adopting the newer record would refresh the version token while the draft still describes
        // the older plan, which is exactly the write `expectedUpdatedAt` exists to refuse. Unsaved
        // edits therefore keep the old token and wait for the user to decide.
        if (dirty) setConflict(event.project);
        else adopt(event.project);
      });
    } catch {
      return undefined;
    }
  }, [adopt, projectId, runtime]);

  const patch = (next: PlanDraft) => {
    setDraft(next);
    setSaved(false);
  };

  const save = async () => {
    if (!update || !base || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setIssue(undefined);
    try {
      adopt(await runtime.production.updatePlan(projectId, update));
      setSaved(true);
    } catch (error) {
      const next = issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "这次微调没有保存成功", action: "retry" });
      setIssue(next);
      // Someone else already wrote. The draft stays as it is: reloading over it would silently drop
      // work the user can still see on screen.
      if (next.code === "PRODUCTION_PLAN_VERSION_STALE") {
        const latest = await runtime.production.get(projectId).catch(() => undefined);
        if (latest) setConflict(latest);
      }
    } finally {
      inFlight.current = false;
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

  if (!base || !draft) {
    return (
      <AppShell activeNav="create" backPath={pathForRoute("create")} headerMode="detail" navigate={navigate} title="微调导出">
        <EmptyState action={<Button onClick={back}>回到制作</Button>} description="这个制作项目已经不在本机了，请返回制作页重新选择。" icon="movie_edit" title="找不到这个项目" />
        {issue ? <IssueNotice issue={issue} /> : null}
      </AppShell>
    );
  }

  if (!plan.editable) {
    return (
      <AppShell activeNav="create" backPath={pathForRoute("create")} headerMode="detail" navigate={navigate} subtitle={base.brief} title="微调导出">
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
          {saving ? "正在保存微调" : problem ? "还不能保存" : update ? "保存微调" : saved ? "已保存" : "还没有改动"}
        </Button>
      )}
      headerMode="detail"
      navigate={navigate}
      subtitle={`共 ${plan.shots.length} 个镜头 · ${(total / 1_000).toFixed(1)} 秒`}
      title="微调导出"
    >
      {/* The stale code is explained by the conflict banner below, which can also act on it. Routing
          it through the shared notice would offer a "重试" that means "render" on the workbench, and
          promise that saved work is safe when the point is that this save did not land. */}
      {issue && issue.code !== "PRODUCTION_PLAN_VERSION_STALE" ? (
        isInlineIssueAction(issue.action)
          // #108 reports which field is wrong in `userMessage`; the shared notice shows only the
          // mapped title and generic guidance, which would hide it.
          ? <aside className="issue-notice issue-notice--error" role="alert"><strong>{issueTitle(issue)}</strong><small>{issue.userMessage}</small></aside>
          : <IssueNotice actions={{ retry: save }} issue={issue} />
      ) : null}

      {conflict ? (
        <aside className="production-edit-stale" role="alert">
          <strong>这个计划刚刚在别处被改过</strong>
          <p>你的改动还留在这一页上，但本机存的计划已经比它新，现在保存会被拒绝。可以改用最新计划（这一页的改动会丢掉），或者先记下要改的地方再重新调整。</p>
          <Button onClick={() => { adopt(conflict); setIssue(undefined); setSaved(false); }} variant="secondary">用最新计划，放弃这一页的改动</Button>
        </aside>
      ) : null}

      {problem ? <p className="production-hint" role="status"><Icon name="error" size={16} />{problem}</p> : null}

      {base.output ? (
        <p className="production-hint">
          <Icon name="info" size={16} />
          已经有一条合成好的成片。保存微调会把它作废，需要回到制作页重新合成。
        </p>
      ) : null}

      {!editableStatus(base) ? (
        <p className="production-hint" role="status">
          <Icon name="pending" size={16} />
          这个项目正在处理中，等它结束后才能保存微调。
        </p>
      ) : null}

      {/* Says plainly what the copy was written against. Without this the cases look identical and
          the user re-generates hoping for something the system was never able to do. "Looked but
          could not read it" must not be reported as "never looked": that sends the user to proofread
          the script when the fix is to reshoot the material. */}
      {plan.visualGrounding === "blind" ? (
        <p className="production-hint" role="status">
          <Icon name="info" size={16} />
          {unreadableAssets.length > 0
            ? `系统看过你上传的画面，但有 ${unreadableAssets.length} 个素材看不清，没能用来写口播。这条口播按拆解结构写的，重拍那几个素材会比改文字更有用。`
            : "这条视频的口播是按拆解结构写的，系统没有看过你上传的画面，所以文字不一定对得上每个镜头，需要你逐镜核对。"}
        </p>
      ) : null}
      {plan.visualGrounding === "asset_insight" ? (
        <p className="production-hint" role="status">
          <Icon name="info" size={16} />
          其中 {plan.describedAssetIds.length} 个素材的画面被识别过，这些镜头的口播参考了画面里看得到的内容；其余素材仍按拆解结构写。系统只是看了画面上有什么，没有核对你拍的是不是该拍的那一项。
        </p>
      ) : null}
      {unreadableAssets.length > 0 ? (
        <p className="production-hint" role="status">
          <Icon name="error" size={16} />
          看不清的素材：{unreadableAssets.map((asset) => `${asset.displayName ?? asset.id}（${asset.reshootAdvice}）`).join("；")}。回制作页换掉它们再重新生成。
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
            required
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
        {draft.shots.map((shot) => (
          <ProductionShotEditCard
            disabled={busy}
            draft={shot}
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
            preview={previewShot({ shot, requestedTemplateId: draft.subtitleTemplateId })}
            decorations={plan.decorations}
            shots={draft.shots}
            totalMilliseconds={Math.round(plan.targetDurationSeconds * 1_000)}
          />
        ))}
      </div>

      <p className="production-edit-footnote">
        字幕的进出点按文案和模板重新推算，来源是文字长度而不是真实语音，所以只是接近而非逐字对齐。镜头的数量、顺序和画面比例在这里不能改。
      </p>
    </AppShell>
  );
}
