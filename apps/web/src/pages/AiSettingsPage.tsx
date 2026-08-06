import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AiAsrTransport, AiCapability, AiCapabilityProbeResult, AppRuntime, PublicAiConnectionConfig, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { LoadingState } from "../components/StatePanels";

export interface AiSettingsPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

interface AiDraft {
  readonly baseUrl: string;
  readonly textModel: string;
  readonly visionModel: string;
  readonly asrModel: string;
  readonly asrTransport: AiAsrTransport;
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema: boolean;
}

const emptyDraft: AiDraft = {
  baseUrl: "",
  textModel: "",
  visionModel: "",
  asrModel: "",
  asrTransport: "audio-transcriptions",
  supportsJsonObject: false,
  supportsJsonSchema: false,
};

const capabilityCopy: Readonly<Record<AiCapability, { readonly title: string; readonly detail: string }>> = {
  text: { title: "文本", detail: "使用不含个人数据的小型内置夹具" },
  vision: { title: "视觉", detail: "使用内置图片夹具独立测试" },
  asr: { title: "语音识别", detail: "使用内置短音频夹具独立测试" },
};

function draftFromConfig(config: PublicAiConnectionConfig | undefined): AiDraft {
  if (!config) return emptyDraft;
  return {
    baseUrl: config.baseUrl,
    textModel: config.textModel ?? "",
    visionModel: config.visionModel ?? "",
    asrModel: config.asrModel ?? "",
    asrTransport: config.asrTransport,
    supportsJsonObject: config.supportsJsonObject,
    supportsJsonSchema: config.supportsJsonSchema,
  };
}

/** Probes always use the encrypted saved connection, never the text currently being edited. */
function hasUnsavedProbeInputs(draft: AiDraft, connection: PublicAiConnectionConfig | undefined, apiKey: string): boolean {
  if (!connection || apiKey.trim()) return true;
  return JSON.stringify(draft) !== JSON.stringify(draftFromConfig(connection));
}

function probeLabel(result: AiCapabilityProbeResult | undefined): string {
  if (!result) return "尚未测试";
  return result.status === "succeeded" ? "测试通过" : "测试未通过";
}

function focusAiConnectionForm(): void {
  if (typeof document !== "undefined") document.getElementById("ai-base-url")?.focus();
}

export function AiSettingsPage({ runtime, navigate }: AiSettingsPageProps) {
  const [draft, setDraft] = useState<AiDraft>(emptyDraft);
  const [connection, setConnection] = useState<PublicAiConnectionConfig>();
  const [apiKey, setApiKey] = useState("");
  const [probes, setProbes] = useState<readonly AiCapabilityProbeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState<AiCapability>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const connectionBusy = saving || probing !== undefined;
  const probeBlocked = connectionBusy || hasUnsavedProbeInputs(draft, connection, apiKey);

  const load = useCallback(async () => {
    setLoading(true);
    setIssue(undefined);
    try {
      const [config, results] = await Promise.all([
        runtime.aiSettings.getPublic(),
        runtime.aiSettings.getProbeResults(),
      ]);
      setConnection(config);
      setDraft(draftFromConfig(config));
      setProbes(results);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "AI 设置暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connectionBusy) return;
    setSaving(true);
    setIssue(undefined);
    setSavedMessage(undefined);
    try {
      const saved = await runtime.aiSettings.save({
        baseUrl: draft.baseUrl,
        textModel: draft.textModel,
        visionModel: draft.visionModel,
        asrModel: draft.asrModel,
        asrTransport: draft.asrTransport,
        supportsJsonObject: draft.supportsJsonObject,
        supportsJsonSchema: draft.supportsJsonSchema,
      });
      if (apiKey.trim()) {
        await runtime.aiSettings.replaceApiKey(apiKey);
        setApiKey("");
        setConnection({ ...saved, hasApiKey: true });
      } else {
        setConnection(saved);
      }
      setProbes([]);
      setSavedMessage("公开配置已保存；API Key 不会显示或回传到页面。");
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_SETTINGS_INVALID", message: "AI 设置保存失败", action: "configure_ai" }));
    } finally {
      setSaving(false);
    }
  };

  const probe = async (capability: AiCapability) => {
    if (probeBlocked) return;
    setProbing(capability);
    setIssue(undefined);
    try {
      const result = await runtime.aiSettings.probe(capability);
      setProbes((current) => [...current.filter((item) => item.capability !== capability), result]);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "AI 能力探测未完成", action: "none" }));
    } finally {
      setProbing(undefined);
    }
  };

  if (loading) {
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="AI 连接"><LoadingState description="正在读取公开配置与探测记录" title="加载 AI 设置" /></AppShell>;
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="AI 连接">
      <form className="page-stack page-settings settings-form" onSubmit={save}>
        {issue ? <IssueNotice actions={{ configureAi: focusAiConnectionForm }} issue={issue} /> : null}

        <GlassCard className="settings-security-note" tone="soft">
          <Icon name="key" size={20} />
          <p>{connection?.hasApiKey ? "API Key 已写入设备安全存储。需要更换时，输入新值后保存即可。" : "API Key 尚未写入设备安全存储。填写后仅会写入 Keystore。"}</p>
        </GlassCard>

        <GlassCard className="settings-form__card">
          <label className="settings-field" htmlFor="ai-base-url"><span>Base URL <em>必填</em></span><input autoCapitalize="none" autoComplete="url" id="ai-base-url" inputMode="url" onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" required type="url" value={draft.baseUrl} /></label>
          <label className="settings-field" htmlFor="ai-api-key"><span>API Key <small>仅写入，不会回显</small></span><input autoCapitalize="none" autoComplete="off" id="ai-api-key" onChange={(event) => setApiKey(event.target.value)} placeholder={connection?.hasApiKey ? "已设置；留空则保持不变" : "输入后写入设备安全存储"} spellCheck={false} type="password" value={apiKey} /></label>
        </GlassCard>

        <GlassCard className="settings-form__card">
          <label className="settings-field" htmlFor="ai-text-model"><span>文本模型 <em>必填</em></span><input autoCapitalize="none" id="ai-text-model" onChange={(event) => setDraft((current) => ({ ...current, textModel: event.target.value }))} required value={draft.textModel} /></label>
          <label className="settings-field" htmlFor="ai-vision-model"><span>视觉模型</span><input autoCapitalize="none" id="ai-vision-model" onChange={(event) => setDraft((current) => ({ ...current, visionModel: event.target.value }))} value={draft.visionModel} /></label>
          <label className="settings-field" htmlFor="ai-asr-model"><span>ASR 模型</span><input autoCapitalize="none" id="ai-asr-model" onChange={(event) => setDraft((current) => ({ ...current, asrModel: event.target.value }))} value={draft.asrModel} /></label>
          <label className="settings-field" htmlFor="ai-asr-transport"><span>ASR 传输方式</span><select id="ai-asr-transport" onChange={(event) => setDraft((current) => ({ ...current, asrTransport: event.target.value as AiAsrTransport }))} value={draft.asrTransport}><option value="audio-transcriptions">Audio Transcriptions</option><option value="chat-input-audio">Chat Input Audio</option></select></label>
        </GlassCard>

        <GlassCard className="settings-form__card settings-switches">
          <label className="switch-row"><span><strong>JSON Object</strong><small>供应商支持 JSON Object 输出时启用</small></span><input checked={draft.supportsJsonObject} onChange={(event) => setDraft((current) => ({ ...current, supportsJsonObject: event.target.checked }))} type="checkbox" /></label>
          <label className="switch-row"><span><strong>JSON Schema</strong><small>供应商支持 JSON Schema 输出时启用</small></span><input checked={draft.supportsJsonSchema} onChange={(event) => setDraft((current) => ({ ...current, supportsJsonSchema: event.target.checked }))} type="checkbox" /></label>
        </GlassCard>

        {savedMessage ? <p className="settings-save-note"><Icon name="check_circle" size={16} />{savedMessage}</p> : null}
        <Button disabled={connectionBusy} size="lg" type="submit"><Icon name="check_circle" size={18} />{saving ? "正在保存" : "保存 AI 设置"}</Button>

        <section className="settings-probes" aria-labelledby="ai-probe-title">
          <div className="settings-probes__heading"><div><span className="settings-overline">独立能力探测</span><h2 id="ai-probe-title">文本、视觉与 ASR 分别测试</h2></div><Button disabled={connectionBusy} onClick={() => void load()} size="md" variant="quiet"><Icon name="sync" size={16} />刷新</Button></div>
          {probeBlocked && !connectionBusy ? <p className="field-hint"><Icon name="info" size={15} />请先保存当前 AI 设置后再测试，测试只会使用已写入本机安全存储的连接。</p> : null}
          <div className="probe-list">
            {(Object.keys(capabilityCopy) as readonly AiCapability[]).map((capability) => {
              const result = probes.find((item) => item.capability === capability);
              const copy = capabilityCopy[capability];
              return (
                <GlassCard className="probe-row" key={capability}>
                  <span className={`probe-row__status ${result ? `is-${result.status}` : ""}`.trim()}><Icon name={result?.status === "succeeded" ? "check_circle" : "pending"} size={19} /></span>
                  <div><strong>{copy.title}</strong><small>{result?.model ?? copy.detail}</small>{result?.issue ? <em>{result.issue.userMessage}</em> : null}</div>
                  <div className="probe-row__action"><span>{probeLabel(result)}</span><Button disabled={probeBlocked} onClick={() => void probe(capability)} size="md" variant="secondary">{probing === capability ? "测试中" : "测试"}</Button></div>
                </GlassCard>
              );
            })}
          </div>
        </section>
      </form>
    </AppShell>
  );
}
