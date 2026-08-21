import { useCallback, useEffect, useMemo, useState, type UIEvent } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ContentTemplateInput, ContentTemplateRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { HomeProfileAction } from "../components/HomeProfileAction";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { EmptyState, LoadingState } from "../components/StatePanels";
import { formatTaskTime, platformLabel } from "../features/tasks/task-presenters";
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

export function TemplatesPage({ runtime, navigate }: TemplatesPageProps) {
  const [templates, setTemplates] = useState<readonly ContentTemplateRecord[]>();
  const [sources, setSources] = useState<readonly AnalysisSource[]>([]);
  const [sourceTaskId, setSourceTaskId] = useState("");
  const [filterId, setFilterId] = useState<TemplateFilterId>("all");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [deletingId, setDeletingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [issue, setIssue] = useState<TaskIssue>();

  const load = useCallback(async () => {
    try {
      const [saved, tasks] = await Promise.all([runtime.templates.list(), runtime.tasks.list({ limit: 40 })]);
      const analyzed = await Promise.all(tasks.map(async (task) => ({ task, analysis: await runtime.analysis.get(task.id) })));
      const available = analyzed.filter(({ analysis }) => analysis?.status === "succeeded" && analysis.result?.schemaVersion === "content-analysis.v1")
        .map(({ task }) => ({ task, label: sourceLabel(task) }));
      setTemplates(saved);
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
  const filtered = useMemo(
    () => (templates ?? []).filter((record) => matchesFilter(record, activeFilter.keyword)),
    [activeFilter.keyword, templates],
  );

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

  const remove = async (templateId: string) => {
    if (busy) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await runtime.templates.delete(templateId);
      if (editingId === templateId) { setEditingId(undefined); setDraft(EMPTY_DRAFT); }
      setDeletingId(undefined);
      await load();
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "STORAGE_WRITE_FAILED", message: "模板没有删除完成", action: "retry" }));
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (field: keyof TemplateDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const editedTemplate = templates?.find((item) => item.templateId === editingId);

  const onFeaturedScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    const first = scroller.children.item(0) as HTMLElement | null;
    const second = scroller.children.item(1) as HTMLElement | null;
    if (!first) return;
    const stride = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    if (stride <= 0) return;
    const next = Math.round(scroller.scrollLeft / stride);
    setFeaturedIndex(Math.min(Math.max(next, 0), Math.max((templates?.length ?? 1) - 1, 0)));
  };

  return (
    <AppShell
      activeNav="templates"
      headerAction={(
        <div className="templates-masthead-actions">
          <Button className="header-action__button" disabled={busy} icon={<Icon name="sparkle" size={17} />} onClick={startCustom} variant="secondary">新建</Button>
          <HomeProfileAction navigate={navigate} runtime={runtime} />
        </div>
      )}
      navigate={navigate}
      subtitle="套用验证过的结构，快速开拍同款"
      title="模板"
    >
      <div className="page-stack page-templates template-workspace templates-board" data-feature-capability={runtime.features.templates}>
        {readIssue ? <IssueNotice issue={readIssue} /> : null}
        {issue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), retry: () => void load(), editInput: focusTemplateName }} issue={issue} /> : null}

        <section className="templates-recommend">
          <div className="templates-section-head">
            <h3>推荐模板</h3>
            <span className="templates-section-hint">本机精选 · 滑动查看</span>
          </div>
          {templates === undefined ? <LoadingState description="正在读取本地模板文件" title="读取模板" /> : templates.length === 0 ? (
            <EmptyState description="保存本机公式后，会在这里横向滑动查看。" icon="layout_template" title="还没有可滑动的本机模板" />
          ) : (
            <>
              <div className="templates-carousel" onScroll={onFeaturedScroll}>
                {templates.map((record) => (
                  <button aria-label={`打开模板 ${record.name}`} className="templates-featured-card" key={record.templateId} onClick={() => edit(record)} type="button">
                    <div className={`templates-cover templates-cover--${coverTone(record.templateId)}`}>
                      <p>{formulaPreview(record)}</p>
                    </div>
                    <span className="templates-featured-card__badge">我的</span>
                    <div className="templates-featured-card__scrim">
                      <strong>{record.name}</strong>
                      <p>{formulaPreview(record)}</p>
                      <small>{templateMeta(record)}</small>
                    </div>
                  </button>
                ))}
              </div>
              {templates.length > 1 ? (
                <div aria-hidden="true" className="templates-dots">
                  {templates.map((record, index) => <span className={index === featuredIndex ? "templates-dot is-active" : "templates-dot"} key={record.templateId} />)}
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
          {templates === undefined ? null : templates.length === 0 ? (
            <EmptyState action={<Button onClick={startCustom} variant="secondary">创建空白模板</Button>} description="你可以从拆解保存，也可以从空白结构开始自定义。" icon="content_paste" title="还没有模板" />
          ) : filtered.length === 0 ? (
            <EmptyState description="当前筛选只匹配名称、摘要或公式里的关键字。" icon="filter" title="未解析到这类模板" />
          ) : (
            <div className="templates-catalog-list">
              {filtered.map((record) => (
                <button aria-label={`使用模板 ${record.name}`} className={record.templateId === editingId ? "templates-catalog-row is-active" : "templates-catalog-row"} key={record.templateId} onClick={() => edit(record)} type="button">
                  <span className={`templates-catalog-thumb templates-cover templates-cover--${coverTone(record.templateId)}`}><span>{formulaPreview(record)}</span></span>
                  <span className="templates-catalog-body">
                    <span className="templates-catalog-title"><strong>{record.name}</strong><span className="templates-mine-tag">我的</span></span>
                    <span className="templates-catalog-formula">{formulaPreview(record)}</span>
                    <span className="templates-catalog-meta">{templateMeta(record)}</span>
                  </span>
                  <span className="templates-use">使用</span>
                </button>
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
              deletingId === editingId ? (
                <div className="template-delete-confirm" role="alert">
                  <strong>确认删除模板“{editedTemplate?.name ?? "当前模板"}”？</strong>
                  <p>只删除这份本地模板，不会级联删除来源任务。</p>
                  <div className="mobile-action-group"><Button disabled={busy} onClick={() => void remove(editingId)}>确认删除模板</Button><Button disabled={busy} onClick={() => setDeletingId(undefined)} variant="quiet">取消</Button></div>
                </div>
              ) : <Button aria-label={`删除模板 ${editedTemplate?.name ?? ""}`} disabled={busy} onClick={() => setDeletingId(editingId)} variant="quiet"><Icon name="close" size={16} />删除</Button>
            ) : null}
          </GlassCard>
        ) : null}
      </div>
    </AppShell>
  );
}
