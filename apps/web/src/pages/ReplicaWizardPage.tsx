import { useCallback, useEffect, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, ProductionProjectRecord, ReplicaBlueprintRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice, isInlineIssueAction, issueTitle } from "../components/IssueNotice";
import { ReplicaRequirementCard } from "../components/ReplicaRequirementCard";
import { EmptyState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import {
  readReplicaBlueprint,
  requirementBindings,
  skipEffectHint,
  unboundAssetCount,
  wizardReadiness,
} from "../features/replica/replica-blueprint-view";
import { pathForRoute, productionEditPath, taskDetailPath, type Navigate } from "../router";
import { useAppResume } from "../hooks/useAppResume";

export interface ReplicaWizardPageProps {
  readonly taskId: string;
  readonly navigate: Navigate;
  readonly runtime: AppRuntime;
}

type Pending = "blueprint" | "project" | "plan" | "asset" | undefined;

/**
 * Business refusals put the reason in `userMessage`. The shared notice maps the code to a generic
 * title and only shows action guidance, which would hide why a tap did nothing.
 */
function WizardIssue({ issue, retry }: { readonly issue: TaskIssue; readonly retry?: () => void }) {
  if (isInlineIssueAction(issue.action) || issue.action === "none") {
    return (
      <aside className="issue-notice issue-notice--error" role="alert">
        <strong>{issueTitle(issue)}</strong>
        <small>{issue.userMessage}</small>
      </aside>
    );
  }
  return <IssueNotice {...(retry ? { actions: { retry } } : {})} issue={issue} />;
}

export function ReplicaWizardPage({ taskId, navigate, runtime }: ReplicaWizardPageProps) {
  const [record, setRecord] = useState<ReplicaBlueprintRecord>();
  const [project, setProject] = useState<ProductionProjectRecord>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending>();
  // The retry travels with the failure, so "重试" always redoes the step that failed instead of
  // whatever the current stage of the wizard would otherwise run.
  const [failure, setFailure] = useState<{ readonly issue: TaskIssue; readonly retry?: () => void }>();
  const issue = failure?.issue;
  const setIssue = (next: TaskIssue | undefined) => { setFailure(next ? { issue: next } : undefined); };

  const load = useCallback(async function reload(): Promise<void> {
    setLoading(true);
    try {
      const next = await runtime.replica.get(taskId);
      setRecord(next);
      setProject(next?.projectId ? await runtime.production.get(next.projectId) : undefined);
    } catch (error) {
      // Reading failed, so we do not know whether a list already exists — retry the read rather than
      // offering to generate one over the top of it.
      setFailure({
        issue: issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "这条爆款的复刻清单暂时无法读取", action: "retry" }),
        retry: () => { void reload(); },
      });
    } finally {
      setLoading(false);
    }
  }, [runtime, taskId]);

  useEffect(() => { void load(); }, [load]);

  const applyAssetRecovery = useCallback(async () => {
    const recovered = await runtime.production.consumeAssetRecovery().catch(() => ({ status: "none" as const }));
    if (recovered.status === "succeeded") {
      setProject(recovered.project);
      setPending(undefined);
    } else if (recovered.status === "failed") {
      setIssue(recovered.issue);
      setPending(undefined);
    }
  }, [runtime]);

  useAppResume(() => {
    void applyAssetRecovery();
  });

  // An external picker can rebuild the WebView, so the returned file is claimed on arrival. The item
  // it belongs to was written down before the picker opened, so it survives the rebuild.
  useEffect(() => {
    void applyAssetRecovery();
  }, [applyAssetRecovery]);

  const run = async (kind: Exclude<Pending, undefined>, operation: () => Promise<void>, fallback: string) => {
    if (pending) return;
    setPending(kind);
    setFailure(undefined);
    try {
      await operation();
    } catch (error) {
      setFailure({
        issue: issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: fallback, action: "retry" }),
        retry: () => { void run(kind, operation, fallback); },
      });
    } finally {
      setPending(undefined);
    }
  };

  const blueprint = readReplicaBlueprint(record?.blueprint);
  const bindings = requirementBindings(blueprint.requirements, project?.assets ?? []);
  const readiness = wizardReadiness(bindings);
  const strays = unboundAssetCount(project?.assets ?? []);
  const busy = pending !== undefined;

  const generate = () => run("blueprint", async () => {
    setRecord(await runtime.replica.run(taskId));
    setProject(undefined);
  }, "复刻清单没有生成成功");

  const start = () => run("project", async () => {
    setProject(await runtime.replica.startProject(taskId));
  }, "没能打开这条爆款的制作项目");

  const bind = (order: number) => run("asset", async () => {
    if (!project) return;
    setProject(await runtime.production.importAssets(project.projectId, { requirementOrder: order }));
  }, "素材没有导入成功");

  const unbind = (assetId: string) => run("asset", async () => {
    if (!project) return;
    setProject(await runtime.production.removeAsset(project.projectId, assetId));
  }, "素材没有移除成功");

  const compose = () => run("plan", async () => {
    if (!project) return;
    const ready = await runtime.production.generatePlan(project.projectId);
    setProject(ready);
    navigate(productionEditPath(ready.projectId));
  }, "脚本和字幕没有生成成功");

  const shell = (children: React.ReactNode, subtitle?: string) => (
    <AppShell
      activeNav="create"
      backPath={taskDetailPath(taskId)}
      className="replica-wizard-page"
      headerMode="detail"
      navigate={navigate}
      {...(subtitle ? { subtitle } : {})}
      title="按清单复刻"
    >
      {children}
    </AppShell>
  );

  const showSkeleton = useSkeletonHold(loading);
  if (showSkeleton) return shell(<PageSkeleton layout="create" />);

  if (!record || record.status === "failed" || !blueprint.usable) {
    const failed = record?.status === "failed";
    return shell(
      <>
        <EmptyState
          action={<Button disabled={busy} onClick={generate}>{pending === "blueprint" ? "正在读这条爆款" : failed ? "重新生成清单" : "生成素材需求清单"}</Button>}
          description={blueprint.emptyReason
            || (failed
              ? "上一次生成没有完成，可以再试一次。"
              : "先让 AI 读一遍这条爆款的拆解，列出你需要拍哪几段素材。清单只列拍摄要求，不会替你判断画面里到底有什么。")}
          icon="movie_edit"
          title={blueprint.emptyReason ? "这条内容拆不出可拍的清单" : "还没有素材需求清单"}
        />
        {record?.issue && !blueprint.emptyReason ? <WizardIssue issue={record.issue} retry={generate} /> : null}
        {issue ? <WizardIssue {...(failure?.retry ? { retry: failure.retry } : {})} issue={issue} /> : null}
      </>,
    );
  }

  return shell(
    <>
      {issue ? <WizardIssue {...(failure?.retry ? { retry: failure.retry } : {})} issue={issue} /> : null}

      <GlassCard className="replica-wizard__premise">
        <h2>怎么复刻这条</h2>
        <p>{blueprint.premise}</p>
        <ul>
          <li>共 {blueprint.requirements.length} 项素材，清单建议合计 {blueprint.totalSuggestedSeconds} 秒。</li>
          <li>成片时长按清单合计定下，不用再从固定档位里挑。</li>
          <li>素材齐了以后生成口播、配音和字幕计划；云端配音不可用时会回退到系统语音。确认微调后再回制作页合成成片。</li>
        </ul>
      </GlassCard>

      {project ? null : (
        <GlassCard className="replica-wizard__start">
          <h2>开始准备素材</h2>
          <p>先按这份清单建一个制作项目，之后逐项把拍好的素材放进对应位置。项目会记住每一项对应哪个文件。</p>
          <Button disabled={busy} onClick={start} size="lg">
            {pending === "project" ? "正在建项目" : "按这份清单建项目"}
          </Button>
        </GlassCard>
      )}

      {project ? (
        <>
          <p className="replica-wizard__progress" role="status">
            已绑定 {readiness.boundCount}/{blueprint.requirements.length} 项 · 成片 {project.targetDurationSeconds} 秒
          </p>

          {readiness.ready ? null : (
            <p className="production-hint" role="status">
              <Icon name="info" size={16} />
              {readiness.blockedReason}
            </p>
          )}

          {skipEffectHint(bindings, project.targetDurationSeconds) ? (
            <p className="production-hint">
              <Icon name="info" size={16} />
              {skipEffectHint(bindings, project.targetDurationSeconds)}
            </p>
          ) : null}

          {strays > 0 ? (
            <p className="production-hint">
              <Icon name="info" size={16} />
              这个项目里还有 {strays} 个不属于清单的素材。它们不会被排进镜头，需要的话回制作页删掉。
            </p>
          ) : null}

          <div className="replica-wizard__list">
            {bindings.map((binding) => (
              <ReplicaRequirementCard
                binding={binding}
                disabled={busy}
                key={binding.requirement.order}
                onImport={() => bind(binding.requirement.order)}
                onRemove={() => { if (binding.asset) unbind(binding.asset.id); }}
              />
            ))}
          </div>

          <div className="replica-wizard__finish">
            <Button disabled={busy || !readiness.ready} onClick={compose} size="lg">
              {pending === "plan" ? "正在写脚本和字幕" : "生成脚本与字幕"}
            </Button>
            <small>
              已绑定的素材会按清单编号从前往后成镜；跳过的项不会留空镜头，后面的素材会往前顶。生成完可以在微调页改时长和文案，再回制作页合成成片。
            </small>
          </div>
        </>
      ) : null}

      <p className="replica-wizard__footnote">
        清单来自这条爆款的正式拆解，只说明该拍什么，不代表画面里真的有这些内容。素材始终只留在本机，不会上传。
        想换一份清单，需要先在
        <button className="replica-wizard__link" onClick={() => navigate(pathForRoute("create"))} type="button">制作页</button>
        删掉正在用它的项目，否则已经拍好的素材会对不上新的清单项。
      </p>
    </>,
    `${blueprint.requirements.length} 项素材 · 清单合计 ${blueprint.totalSuggestedSeconds} 秒`,
  );
}
