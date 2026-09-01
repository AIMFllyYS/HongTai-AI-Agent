import { contentAnalysisResultSchema } from "@hongtai/ai";
import { TaskError } from "@hongtai/core";
import type {
  AnalysisService,
  ContentTemplateInput,
  ContentTemplateRecord,
  LinkedRecordDeleteOptions,
  TemplateService,
} from "@hongtai/core";

const TEMPLATE_PATH = "template.json";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;

interface TemplateFilesPort {
  ensureTemplate(options: { readonly templateId: string }): Promise<void>;
  writeTemplateText(options: { readonly templateId: string; readonly relativePath: string; readonly value: string; readonly replace: boolean }): Promise<void>;
  readTemplateText(options: { readonly templateId: string; readonly relativePath: string }): Promise<{ readonly value?: string }>;
  listTemplateIds(): Promise<{ readonly templateIds: readonly string[] }>;
  deleteTemplate(options: { readonly templateId: string }): Promise<void>;
}

export interface StandaloneTemplateServiceOptions {
  readonly files: TemplateFilesPort;
  readonly analysis: Pick<AnalysisService, "get">;
  readonly createTemplateId?: () => string;
  readonly now?: () => Date;
  /**
   * 级联删除入口，由组合根注入：删除模板的来源任务及其全部派生模板。
   * 拆解与模板是同一内容，删除必须双向联动；仅在未装配的组合根（如纯服务单测）
   * 缺失，此时 delete 退化为只删模板记录。
   */
  readonly deleteTaskCascade?: (taskId: string, options?: LinkedRecordDeleteOptions) => Promise<void>;
}

function templateError(message: string, action: "edit_input" | "retry" = "edit_input"): TaskError {
  return new TaskError({ code: "TASK_ARTIFACT_MISSING", message, action });
}

function generatedTemplateId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return uuid ? `template-${uuid}` : `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function boundedText(value: string, label: string, maximum: number, required = false): string {
  const normalized = value.trim();
  if (required && !normalized) throw templateError(`${label}不能为空`);
  if (normalized.length > maximum) throw templateError(`${label}最多${maximum}个字符`);
  return normalized;
}

function boundedRows(values: readonly string[], label: string): readonly string[] {
  if (values.length > 40) throw templateError(`${label}最多40项`);
  return values.map((value) => boundedText(value, label, 300)).filter(Boolean);
}

function normalizedInput(input: ContentTemplateInput): ContentTemplateInput {
  if (!Array.isArray(input.steps) || !Array.isArray(input.variableSlots)) throw templateError("模板步骤或变量格式无效");
  return {
    name: boundedText(input.name, "模板名称", 80, true),
    summary: boundedText(input.summary, "模板摘要", 2_000),
    formula: boundedText(input.formula, "模板公式", 2_000),
    steps: boundedRows(input.steps, "模板步骤"),
    variableSlots: boundedRows(input.variableSlots, "模板变量"),
  };
}

function parseTemplate(value: string, templateId: string): ContentTemplateRecord | undefined {
  try {
    const parsed = JSON.parse(value) as ContentTemplateRecord;
    if (parsed.templateId !== templateId || !IDENTIFIER.test(templateId) || typeof parsed.createdAt !== "string" || typeof parsed.updatedAt !== "string") return undefined;
    if (parsed.sourceTaskId !== undefined && !IDENTIFIER.test(parsed.sourceTaskId)) return undefined;
    return {
      templateId,
      ...normalizedInput(parsed),
      ...(parsed.sourceTaskId ? { sourceTaskId: parsed.sourceTaskId } : {}),
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return undefined;
  }
}

export class StandaloneTemplateService implements TemplateService {
  readonly #options: StandaloneTemplateServiceOptions;
  readonly #mutations = new Map<string, Promise<unknown>>();

  constructor(options: StandaloneTemplateServiceOptions) {
    this.#options = options;
  }

  async list(): Promise<readonly ContentTemplateRecord[]> {
    const { templateIds } = await this.#options.files.listTemplateIds();
    const templates = await Promise.all(templateIds.map((templateId) => this.get(templateId)));
    return templates.filter((value): value is ContentTemplateRecord => Boolean(value))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(templateId: string): Promise<ContentTemplateRecord | undefined> {
    if (!IDENTIFIER.test(templateId)) return undefined;
    const response = await this.#options.files.readTemplateText({ templateId, relativePath: TEMPLATE_PATH });
    return response.value ? parseTemplate(response.value, templateId) : undefined;
  }

  async createFromAnalysis(taskId: string): Promise<ContentTemplateRecord> {
    if (!IDENTIFIER.test(taskId)) throw templateError("来源任务标识无效");
    const record = await this.#options.analysis.get(taskId);
    const parsed = record?.status === "succeeded" && record.result?.schemaVersion === "content-analysis.v1"
      ? contentAnalysisResultSchema.safeParse(record.result.document)
      : undefined;
    if (!parsed?.success || parsed.data.source.taskId !== taskId) {
      throw templateError("来源任务没有可保存的正式拆解模板", "retry");
    }
    return this.#create({
      name: parsed.data.overview.theme || "内容模板",
      summary: parsed.data.overview.summary,
      formula: parsed.data.reusableTemplate.formula,
      steps: parsed.data.reusableTemplate.steps,
      variableSlots: parsed.data.reusableTemplate.variableSlots,
    }, taskId);
  }

  async create(input: ContentTemplateInput): Promise<ContentTemplateRecord> {
    return this.#create(input);
  }

  async update(templateId: string, input: ContentTemplateInput): Promise<ContentTemplateRecord> {
    return this.#exclusive(templateId, async () => {
      const existing = await this.get(templateId);
      if (!existing) throw templateError("要编辑的模板不存在");
      const updated: ContentTemplateRecord = {
        templateId,
        ...normalizedInput(input),
        ...(existing.sourceTaskId ? { sourceTaskId: existing.sourceTaskId } : {}),
        createdAt: existing.createdAt,
        updatedAt: this.#now(),
      };
      await this.#save(updated);
      return updated;
    });
  }

  async delete(templateId: string, options?: LinkedRecordDeleteOptions): Promise<void> {
    const existing = await this.get(templateId);
    if (!existing) throw templateError("要删除的模板不存在");
    if (existing.sourceTaskId && this.#options.deleteTaskCascade) {
      try {
        await this.#options.deleteTaskCascade(existing.sourceTaskId, options);
        return;
      } catch (error) {
        // 来源任务已不存在时退化为只删模板记录，悬挂模板仍可删除。
        if (!(error instanceof TaskError && error.code === "TASK_ARTIFACT_MISSING")) throw error;
      }
    }
    await this.deleteRecord(templateId);
  }

  /** 只删除模板记录，不触发与来源任务的联动；供组合根的级联编排调用。 */
  async deleteRecord(templateId: string): Promise<void> {
    return this.#exclusive(templateId, async () => {
      if (!await this.get(templateId)) throw templateError("要删除的模板不存在");
      await this.#options.files.deleteTemplate({ templateId });
    });
  }

  async #create(input: ContentTemplateInput, sourceTaskId?: string): Promise<ContentTemplateRecord> {
    const templateId = this.#options.createTemplateId?.() ?? generatedTemplateId();
    if (!IDENTIFIER.test(templateId)) throw templateError("模板标识无效");
    return this.#exclusive(templateId, async () => {
      if (await this.get(templateId)) throw templateError("模板标识已存在");
      const timestamp = this.#now();
      const record: ContentTemplateRecord = {
        templateId,
        ...normalizedInput(input),
        ...(sourceTaskId ? { sourceTaskId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#options.files.ensureTemplate({ templateId });
      await this.#save(record);
      return record;
    });
  }

  async #save(record: ContentTemplateRecord): Promise<void> {
    await this.#options.files.writeTemplateText({
      templateId: record.templateId,
      relativePath: TEMPLATE_PATH,
      value: JSON.stringify(record),
      replace: true,
    });
  }

  #now(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }

  async #exclusive<T>(templateId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#mutations.has(templateId)) throw templateError("模板正在处理另一项操作，请稍后再试", "retry");
    const active = operation();
    this.#mutations.set(templateId, active);
    try {
      return await active;
    } finally {
      if (this.#mutations.get(templateId) === active) this.#mutations.delete(templateId);
    }
  }
}
