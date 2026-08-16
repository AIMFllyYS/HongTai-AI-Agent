import { useCallback, useEffect, useState } from "react";
import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, AppTaskRecord, ContentTemplateInput, ContentTemplateRecord, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
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

export function TemplatesPage({ runtime, navigate }: TemplatesPageProps) {
  const [templates, setTemplates] = useState<readonly ContentTemplateRecord[]>();
  const [sources, setSources] = useState<readonly AnalysisSource[]>([]);
  const [sourceTaskId, setSourceTaskId] = useState("");
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

  return (
    <AppShell
      activeNav="templates"
      headerAction={<Button className="header-action__button" disabled={busy} icon={<Icon name="sparkle" size={17} />} onClick={startCustom} variant="secondary">新建</Button>}
      leadingAction={<span className="page-header-icon"><Icon name="content_paste" size={24} /></span>}
      navigate={navigate}
      title="模板"
    >
      <div className="page-stack page-templates template-workspace" data-feature-capability={runtime.features.templates}>
        <section className="template-hero">
          <span className="eyebrow">REUSABLE STRUCTURE</span>
          <h2>把拆解方法变成自己的内容模版</h2>
          <p>这里只保存公式、步骤与变量槽，不复制原视频、供应商响应或推理内容。保存后可独立编辑和删除。</p>
        </section>

        {readIssue ? <IssueNotice issue={readIssue} /> : null}
        {issue ? <IssueNotice actions={{ configureAi: () => navigate(aiSettingsPath()), retry: () => void load(), editInput: focusTemplateName }} issue={issue} /> : null}

        <GlassCard className="template-import-card">
          <div className="production-section-title"><span>01</span><div><strong>从拆解结果保存</strong><small>把内容结构保存成以后可以继续使用的模板</small></div></div>
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

        <section className="template-library-section">
          <div className="section-heading"><div><span className="eyebrow">LOCAL TEMPLATES</span><h3>我的模板</h3></div>{readIssue ? <button className="text-action" onClick={() => void load()} type="button">刷新</button> : null}</div>
          {templates === undefined ? <LoadingState description="正在读取本地模板文件" title="读取模板" /> : templates.length === 0 ? <EmptyState action={<Button onClick={startCustom} variant="secondary">创建空白模板</Button>} description="你可以从拆解保存，也可以从空白结构开始自定义。" icon="content_paste" title="还没有模板" /> : (
            <div className="template-list">
              {templates.map((record) => (
                <GlassCard className={record.templateId === editingId ? "template-card is-active" : "template-card"} key={record.templateId}>
                  <button className="template-card__open" onClick={() => edit(record)} type="button">
                    <span><Icon name="content_paste" size={18} /></span>
                    <div><strong>{record.name}</strong><p>{record.summary || record.formula || "尚未填写摘要或公式"}</p><small>{record.steps.length} 个步骤 · {record.variableSlots.length} 个变量</small></div>
                    <Icon name="chevron_right" size={18} />
                  </button>
                  {deletingId === record.templateId ? (
                    <div className="template-delete-confirm" role="alert">
                      <strong>确认删除模板“{record.name}”？</strong>
                      <p>只删除这份本地模板，不会级联删除来源任务。</p>
                      <div className="mobile-action-group"><Button disabled={busy} onClick={() => void remove(record.templateId)}>确认删除模板</Button><Button disabled={busy} onClick={() => setDeletingId(undefined)} variant="quiet">取消</Button></div>
                    </div>
                  ) : <Button aria-label={`删除模板 ${record.name}`} disabled={busy} onClick={() => setDeletingId(record.templateId)} variant="quiet"><Icon name="close" size={16} />删除</Button>}
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        {editingId ? (
          <GlassCard className="template-editor">
            <div className="production-section-title"><span>02</span><div><strong>{editingId === "new" ? "自定义新模板" : `编辑 ${editedTemplate?.name ?? "模板"}`}</strong><small>每行一个步骤或变量；空行不会保存</small></div></div>
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
          </GlassCard>
        ) : null}
      </div>
    </AppShell>
  );
}
