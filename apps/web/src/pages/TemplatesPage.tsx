import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ContentTemplateInput, ContentTemplateRecord, MediaReference, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { ConfirmDeleteSheet } from "../components/ConfirmDeleteSheet";
import { GlassCard } from "../components/GlassCard";
import { HomeMastheadActions } from "../components/HomeMastheadActions";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { RenameSheet } from "../components/RenameSheet";
import { Sheet, SheetActionRow } from "../components/Sheet";
import { EmptyState } from "../components/StatePanels";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
import { useLongPress } from "../hooks/useLongPress";
import { aiSettingsPath, type Navigate } from "../router";

export interface TemplatesPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: Navigate;
}

interface TemplateDraft {
  readonly name: string;
  readonly summary: string;
  readonly formula: string;
  readonly steps: string;
  readonly variableSlots: string;
}

interface AnalysisSource {
  readonly task: AppTaskRecord;
  readonly label: string;
}

const EMPTY_DRAFT: TemplateDraft = { name: "", summary: "", formula: "", steps: "", variableSlots: "" };

const TEMPLATE_FILTERS = [
  { id: "all", label: "全部", keyword: "" },
  { id: "workplace", label: "职场", keyword: "职场" },
  { id: "store", label: "到店", keyword: "到店" },
  { id: "commerce", label: "带货", keyword: "带货" },
  { id: "knowledge", label: "知识", keyword: "知识" },
] as const;

type TemplateFilterId = (typeof TEMPLATE_FILTERS)[number]["id"];

function focusTemplateName(): void {
  if (typeof document !== "undefined") document.getElementById("template-name")?.focus();
}

function draftFrom(record: ContentTemplateRecord): TemplateDraft {
  return { ...record, steps: record.steps.join("\n"), variableSlots: record.variableSlots.join("\n") };
}

function inputFrom(draft: TemplateDraft): ContentTemplateInput {
  const rows = (value: string) => value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  return { name: draft.name, summary: draft.summary, formula: draft.formula, steps: rows(draft.steps), variableSlots: rows(draft.variableSlots) };
}

function sourceLabel(task: AppTaskRecord): string {
  const source = task.sourceKind === "local_video" ? "本地上传" : platformLabel(task.platform) || "内容任务";
  return `${source} · ${formatTaskTime(task.updatedAt)}`;
}

function formulaPreview(record: ContentTemplateRecord): string {
  return record.formula.trim() || record.summary.trim() || "尚未填写摘要或公式";
}

function templateMeta(record: ContentTemplateRecord): string {
  return `${record.variableSlots.length} 个可替换位 · 使用次数未解析到`;
}

function matchesFilter(record: ContentTemplateRecord, keyword: string): boolean {
  if (!keyword) return true;
  return `${record.name}\n${record.summary}\n${record.formula}`.includes(keyword);
}

function coverTone(templateId: string): number {
  let total = 0;
  for (let index = 0; index < templateId.length; index += 1) total += templateId.charCodeAt(index);
  return total % 4;
}

function coverMediaFor(record: ContentTemplateRecord, covers: ReadonlyMap<string, MediaReference>): MediaReference | undefined {
  return record.sourceTaskId ? covers.get(record.sourceTaskId) : undefined;
}

/**
 * 仅在持久化首帧缺失时短暂使用的兜底：卸载时立即释放底层解码资源，
 * 避免 WebView 原生 MediaPlayer 靠 GC 回收而耗尽（封面渐进失效的根因之一）。
 */
function TemplateCoverVideo({ name, uri, onError }: { readonly name: string; readonly uri: string; readonly onError: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [uri]);

  return (
    <video
      aria-label={`${name}来源视频首帧`}
      className="templates-cover-media"
      muted
      onError={onError}
      onLoadedData={(event) => { event.currentTarget.currentTime = 0; }}
      playsInline
      preload="metadata"
      ref={videoRef}
      src={uri}
    />
  );
}

function TemplateCoverContent({ record, media }: { readonly record: ContentTemplateRecord; readonly media: MediaReference | undefined }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [media?.uri]);

  if (failed) {
    return <span className="templates-cover-unavailable"><Icon name="video" size={22} /><span>原视频封面不可用</span></span>;
  }
  if (media?.kind === "image") {
    return <img alt={`${record.name}来源视频封面`} className="templates-cover-media" decoding="async" loading="lazy" onError={() => setFailed(true)} src={media.uri} />;
  }
  if (media?.kind === "video") {
    return <TemplateCoverVideo name={record.name} onError={() => setFailed(true)} uri={media.uri} />;
  }
  if (record.sourceTaskId) {
    return <span className="templates-cover-unavailable"><Icon name="video" size={22} /><span>原视频封面不可用</span></span>;
  }
  return <p>{formulaPreview(record)}</p>;
}

function TemplateFeaturedCard({ record, media, onOpen, onLongPress }: { readonly record: ContentTemplateRecord; readonly media: MediaReference | undefined; readonly onOpen: () => void; readonly onLongPress: () => void }) {
  const longPress = useLongPress({ onClick: onOpen, onLongPress });
  return (
    <button aria-label={`打开模板 ${record.name}，长按管理模板`} className="templates-featured-card" {...longPress} type="button">
      <div className={`templates-cover templates-cover--${coverTone(record.templateId)} ${media ? "templates-cover--media" : ""}`.trim()}><TemplateCoverContent media={media} record={record} /></div>
      <span className="templates-featured-card__badge">我的</span>
      <div className="templates-featured-card__scrim">
        <strong>{record.name}</strong>
        <p>{formulaPreview(record)}</p>
        <small>{templateMeta(record)}</small>
      </div>
    </button>
  );
}

function TemplateCatalogRow({ record, media, active, onOpen, onLongPress }: { readonly record: ContentTemplateRecord; readonly media: MediaReference | undefined; readonly active: boolean; readonly onOpen: () => void; readonly onLongPress: () => void }) {
  const longPress = useLongPress({ onClick: onOpen, onLongPress });
  return (
    <button aria-label={`使用模板 ${record.name}，长按管理模板`} className={active ? "templates-catalog-row is-active" : "templates-catalog-row"} {...longPress} type="button">
      <span className={`templates-catalog-thumb templates-cover templates-cover--${coverTone(record.templateId)} ${media ? "templates-cover--media" : ""}`.trim()}><TemplateCoverContent media={media} record={record} /></span>
      <span className="templates-catalog-body">
        <span className="templates-catalog-title"><strong>{record.name}</strong><span className="templates-mine-tag">我的</span></span>
        <span className="templates-catalog-formula">{formulaPreview(record)}</span>
        <span className="templates-catalog-meta">{templateMeta(record)}</span>
      </span>
      <span className="templates-use">使用</span>
    </button>
  );
}

export function TemplatesPage({ runtime, navigate }: TemplatesPageProps) {
  const [templates, setTemplates] = useState<readonly ContentTemplateRecord[]>();
  const [sourceCovers, setSourceCovers] = useState<ReadonlyMap<string, MediaReference>>(new Map());
  const [sourceTasksById, setSourceTasksById] = useState<ReadonlyMap<string, AppTaskRecord>>(new Map());
  const [sources, setSources] = useState<readonly AnalysisSource[]>([]);
  const [sourceTaskId, setSourceTaskId] = useState("");
  const [filterId, setFilterId] = useState<TemplateFilterId>("all");
  const [query, setQuery] = useState("");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [deletingId, setDeletingId] = useState<string>();
  const [deleteKeepLocalVideo, setDeleteKeepLocalVideo] = useState(true);
  const [actionTargetId, setActionTargetId] = useState<string>();
  const [renameId, setRenameId] = useState<string>();
  const [renameIssue, setRenameIssue] = useState<TaskIssue>();
  const [busy, setBusy] = useState(false);
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [issue, setIssue] = useState<TaskIssue>();

  const load = useCallback(async () => {
    try {
      const [saved, tasks] = await Promise.all([runtime.templates.list(), runtime.tasks.list({ limit: 40 })]);
      const analyzed = await Promise.all(tasks.map(async (task) => ({ task, analysis: await runtime.analysis.get(task.id) })));
      const available = analyzed.filter(({ analysis }) => analysis?.status === "succeeded" && analysis.result?.schemaVersion === "content-analysis.v1")
        .map(({ task }) => ({ task, label: sourceLabel(task) }));
      const sourceIds = [...new Set(saved.flatMap((record) => record.sourceTaskId ? [record.sourceTaskId] : []))];
      const coverEntries = await Promise.all(sourceIds.map(async (taskId) => {
        try {
          const detail = await runtime.tasks.getDetail(taskId);
          const cover = detail?.content.cover ?? detail?.media.find((item) => item.kind === "video");
          return cover ? [taskId, cover] as const : undefined;
        } catch {
          return undefined;
        }
      }));
      setTemplates(saved);
      setSourceCovers(new Map(coverEntries.filter((entry): entry is readonly [string, MediaReference] => Boolean(entry))));
      setSourceTasksById(new Map(tasks.map((task) => [task.id, task])));
      setSources(available);
      setSourceTaskId((current) => current || available[0]?.task.id || "");
      setReadIssue(undefined);
      setIssue(undefined);
    } catch (error) {
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地模板暂时无法读取", action: "none" }));
    }
  }, [runtime]);

  useEffect(() => { void load(); }, [load]);

  const activeFilter = TEMPLATE_FILTERS.find((item) => item.id === filterId) ?? TEMPLATE_FILTERS[0];
  const searchKeyword = query.trim();
  const featured = useMemo(
    () => (templates ?? []).filter((record) => matchesFilter(record, searchKeyword)),
    [searchKeyword, templates],
  );
  const filtered = useMemo(
    () => featured.filter((record) => matchesFilter(record, activeFilter.keyword)),
    [activeFilter.keyword, featured],
  );

  useEffect(() => {
    setFeaturedIndex(0);
  }, [searchKeyword]);

  const edit = (record: ContentTemplateRecord) => {
    setEditingId(record.templateId);
    setDraft(draftFrom(record));
    setDeletingId(undefined);
    setIssue(undefined);
  };

  const startCustom = () => {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
    setDeletingId(undefined);
    setIssue(undefined);
  };

  const importFromAnalysis = async () => {
    if (!sourceTaskId || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      const record = await runtime.templates.createFromAnalysis(sourceTaskId);
      await load();
      edit(record);
      setImportOpen(false);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "INTERNAL_UNKNOWN_ERROR", message: "拆解模板没有保存成功", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editingId || busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      const record = editingId === "new"
        ? await runtime.templates.create(inputFrom(draft))
        : await runtime.templates.update(editingId, inputFrom(draft));
      await load();
      edit(record);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "模板没有保存成功", action: "edit_input" }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (templateId: string, keepLocalVideo: boolean) => {
    if (busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.templates.delete(templateId, { keepLocalVideo });
      if (editingId === templateId) { setEditingId(undefined); setDraft(EMPTY_DRAFT); }
      setDeletingId(undefined);
      await load();
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "模板没有删除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const openDelete = (templateId: string) => {
    setActionTargetId(undefined);
    setDeleteKeepLocalVideo(true);
    setIssue(undefined);
    setDeletingId(templateId);
  };

  const openRename = (templateId: string) => {
    setActionTargetId(undefined);
    setRenameIssue(undefined);
    setRenameId(templateId);
  };

  const submitRename = async (name: string) => {
    const record = templates?.find((item) => item.templateId === renameId);
    if (!record || busy) return;
    setBusy(true);
    setRenameIssue(undefined);
    try {
      await runtime.templates.update(record.templateId, { name, summary: record.summary, formula: record.formula, steps: record.steps, variableSlots: record.variableSlots });
      setRenameId(undefined);
      await load();
    } catch (error) {
      setRenameIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "无法保存模板名称", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (field: keyof TemplateDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const editedTemplate = templates?.find((item) => item.templateId === editingId);
  const actionTemplate = templates?.find((item) => item.templateId === actionTargetId);
  const renameTemplate = templates?.find((item) => item.templateId === renameId);
  const deletingTemplate = templates?.find((item) => item.templateId === deletingId);
  const deletingSourceTask = deletingTemplate?.sourceTaskId ? sourceTasksById.get(deletingTemplate.sourceTaskId) : undefined;
  /** 有来源拆解且本机留有视频时提供勾选框；任务列表查不到来源时按有视频处理，把选择权交给用户。 */
  const deletingHasLocalVideo = Boolean(deletingTemplate?.sourceTaskId) && (!deletingSourceTask || deletingSourceTask.contentType === "video");

  const onFeaturedScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    const first = scroller.children.item(0) as HTMLElement | null;
    const second = scroller.children.item(1) as HTMLElement | null;
    if (!first) return;
    const stride = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    if (stride <= 0) return;
    const next = Math.round(scroller.scrollLeft / stride);
    setFeaturedIndex(Math.min(Math.max(next, 0), Math.max(featured.length - 1, 0)));
  };

  const templatesPending = useSkeletonHold(templates === undefined);

  return (
    <AppShell
      activeNav="templates"
      headerAction={<HomeMastheadActions navigate={navigate} runtime={runtime} />}
      navigate={navigate}
      subtitle="套用验证过的结构，快速开拍同款"
      title="模板"
    >
      <div className="page-stack page-templates template-workspace templates-board" data-feature-capability={runtime.features.templates}>
        {readIssue ? <IssueNotice issue={readIssue} /> : null}
        {issue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), retry: () => void load(), editInput: focusTemplateName }} issue={issue} /> : null}

        <section className="templates-recommend">
          <div className="templates-section-head">
            <label className="templates-search">
              <Icon name="search" size={15} />
              <input
                aria-label="搜索本机模板"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索模板名称、摘要或公式"
                value={query}
              />
              {query ? (
                <button aria-label="清除搜索" className="templates-search__clear" onClick={() => setQuery("")} type="button">
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </label>
            <span className="templates-section-hint">本机精选 · 滑动查看</span>
          </div>
          {templatesPending ? <PageSkeleton layout="templates-list" /> : templates?.length === 0 ? null : featured.length === 0 ? (
            <EmptyState description="搜索只匹配本机模板的名称、摘要或公式，不会编造结果。" icon="filter" title="未解析到这类模板" />
          ) : (
            <>
              <div className="templates-carousel" onScroll={onFeaturedScroll}>
                {featured.map((record) => (
                  <TemplateFeaturedCard key={record.templateId} media={coverMediaFor(record, sourceCovers)} onLongPress={() => { setIssue(undefined); setActionTargetId(record.templateId); }} onOpen={() => edit(record)} record={record} />
                ))}
              </div>
              {featured.length > 1 ? (
                <div aria-hidden="true" className="templates-dots">
                  {featured.map((record, index) => <span className={index === featuredIndex ? "templates-dot is-active" : "templates-dot"} key={record.templateId} />)}
                </div>
              ) : null}
            </>
          )}
        </section>

        <div aria-label="按关键字筛选模板" className="templates-filters" role="radiogroup">
          {TEMPLATE_FILTERS.map((item) => (
            <button
              aria-checked={item.id === filterId}
              className={item.id === filterId ? "templates-filter is-active" : "templates-filter"}
              key={item.id}
              onClick={() => setFilterId(item.id)}
              role="radio"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="templates-catalog">
          <div className="templates-section-head">
            <h3>全部模板</h3>
            {readIssue ? <button className="text-action" onClick={() => void load()} type="button">刷新</button> : null}
            {!readIssue && templates ? <span className="templates-section-hint">{filtered.length} 个</span> : null}
          </div>
          {templatesPending ? <PageSkeleton layout="templates-list" /> : templates?.length === 0 ? (
            <EmptyState action={<Button onClick={startCustom} variant="secondary">创建空白模板</Button>} className="templates-catalog-empty" description="你可以从拆解保存，也可以从空白结构开始自定义。" icon="content_paste" title="还没有模板" />
          ) : filtered.length === 0 ? (
            <EmptyState description="当前筛选只匹配名称、摘要或公式里的关键字。" icon="filter" title="未解析到这类模板" />
          ) : (
            <div className="templates-catalog-list">
                {filtered.map((record) => (
                  <TemplateCatalogRow active={record.templateId === editingId} key={record.templateId} media={coverMediaFor(record, sourceCovers)} onLongPress={() => { setIssue(undefined); setActionTargetId(record.templateId); }} onOpen={() => edit(record)} record={record} />
              ))}
            </div>
          )}

          <button className="templates-save-row" onClick={() => setImportOpen((current) => !current)} type="button">
            <span className="templates-save-row__icon"><Icon name="add" size={14} /></span>
            <span>从拆解结果保存新模板</span>
            <Icon name="chevron_right" size={16} />
          </button>
          {importOpen ? (
            <GlassCard className="template-import-card">
              <div className="production-section-title"><div><strong>从拆解结果保存新模板</strong><small>把内容结构保存成以后可以继续使用的模板</small></div></div>
              {sources.length > 0 ? (
                <div className="template-import-card__controls">
                  <label className="field-label" htmlFor="template-source">拆解来源</label>
                  <select disabled={busy} id="template-source" onChange={(event) => setSourceTaskId(event.target.value)} value={sourceTaskId}>
                    {sources.map(({ task, label }) => <option key={task.id} value={task.id}>{label}</option>)}
                  </select>
                  <Button disabled={busy || !sourceTaskId} icon={<Icon name="bookmark" size={17} />} onClick={() => void importFromAnalysis()}>{busy ? "正在保存" : "保存为模板"}</Button>
                </div>
              ) : <EmptyState description="完成一次正式 AI 拆解后，可在这里复制其中的公式、步骤和变量。" icon="analytics" title="还没有可导入的拆解" />}
            </GlassCard>
          ) : null}
        </section>

        {editingId ? (
          <GlassCard className="template-editor">
            <div className="production-section-title"><div><strong>{editingId === "new" ? "自定义新模板" : `编辑 ${editedTemplate?.name ?? "模板"}`}</strong><small>每行一个步骤或变量；空行不会保存</small></div></div>
            <label className="field-label" htmlFor="template-name">模板名称</label>
            <input id="template-name" maxLength={80} onChange={(event) => updateDraft("name", event.target.value)} placeholder="例如：门店真实体验口播" value={draft.name} />
            <label className="field-label" htmlFor="template-summary">摘要</label>
            <textarea id="template-summary" maxLength={2000} onChange={(event) => updateDraft("summary", event.target.value)} rows={3} value={draft.summary} />
            <label className="field-label" htmlFor="template-formula">内容公式</label>
            <textarea id="template-formula" maxLength={2000} onChange={(event) => updateDraft("formula", event.target.value)} rows={3} value={draft.formula} />
            <div className="template-editor__rows">
              <label><span className="field-label">执行步骤</span><textarea aria-label="模板执行步骤，每行一项" onChange={(event) => updateDraft("steps", event.target.value)} placeholder="提出真实问题&#10;给出证据和方法&#10;引导下一步行动" rows={6} value={draft.steps} /></label>
              <label><span className="field-label">变量槽位</span><textarea aria-label="模板变量槽位，每行一项" onChange={(event) => updateDraft("variableSlots", event.target.value)} placeholder="目标受众&#10;核心痛点&#10;产品名称" rows={6} value={draft.variableSlots} /></label>
            </div>
            <div className="template-editor__actions"><Button disabled={busy || !draft.name.trim()} icon={<Icon name="check_circle" size={17} />} onClick={() => void save()}>{busy ? "正在保存" : "保存修改"}</Button><Button disabled={busy} onClick={() => setEditingId(undefined)} variant="quiet">关闭编辑</Button></div>
            {editingId !== "new" ? (
              <Button aria-label={`删除模板 ${editedTemplate?.name ?? ""}`} disabled={busy} onClick={() => { if (editingId) openDelete(editingId); }} variant="quiet"><Icon name="close" size={16} />删除</Button>
            ) : null}
          </GlassCard>
        ) : null}

        {actionTemplate ? (
          <Sheet className="template-actions-sheet" onClose={() => setActionTargetId(undefined)} open title="模板操作">
            <p className="recent-record-actions-sheet__label">模板 · {actionTemplate.name}</p>
            <div className="sheet-action-list">
              <SheetActionRow
                description="修改模板名称"
                icon={<Icon name="pen_line" size={20} />}
                onSelect={() => openRename(actionTemplate.templateId)}
                title="重命名"
              />
              <SheetActionRow
                description={actionTemplate.sourceTaskId ? "对应拆解记录会一并删除，本机视频可选择保留" : "只删除这份模板，不可恢复"}
                icon={<Icon name="trash_2" size={20} />}
                onSelect={() => openDelete(actionTemplate.templateId)}
                title="删除模板"
              />
            </div>
            <Button className="sheet-cancel" onClick={() => setActionTargetId(undefined)} variant="quiet">取消</Button>
          </Sheet>
        ) : null}

        {renameTemplate ? (
          <RenameSheet
            busy={busy}
            fieldLabel="模板名称"
            initialValue={renameTemplate.name}
            issue={renameIssue}
            onClose={() => setRenameId(undefined)}
            onSubmit={(name) => void submitRename(name)}
            open
            title="重命名模板"
          />
        ) : null}

        <ConfirmDeleteSheet
          busy={busy}
          checkbox={deletingHasLocalVideo ? { label: "同时删除已下载到本机的视频", checked: !deleteKeepLocalVideo, onChange: (checked) => setDeleteKeepLocalVideo(!checked) } : undefined}
          confirmLabel="确认删除"
          dangerNote={deletingTemplate?.sourceTaskId ? "将同时彻底删除对应拆解记录，无法恢复。" : undefined}
          description={deletingTemplate?.sourceTaskId ? "这份模板与它的来源拆解是同一份内容；默认保留已下载到本机的视频。" : "只删除这份模板，不可恢复。"}
          heading={`确认删除模板“${deletingTemplate?.name ?? editedTemplate?.name ?? "当前模板"}”？`}
          issue={deletingId ? issue : undefined}
          onClose={() => setDeletingId(undefined)}
          onConfirm={() => { if (deletingId) void remove(deletingId, deleteKeepLocalVideo); }}
          open={Boolean(deletingId)}
          title="删除模板"
        />
      </div>
    </AppShell>
  );
}
