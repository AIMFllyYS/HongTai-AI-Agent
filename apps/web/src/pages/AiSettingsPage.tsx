import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AI_PROVIDER_PRESETS, issueFromAppError } from "@hongtai/core";
import type { AiAsrTransport, AiCapability, AiCapabilityProbeResult, AiConnectionPublicInput, AiProviderPreset, AiTtsTransport, AppRuntime, PublicAiConnectionConfig, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";

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
  readonly ttsModel: string;
  readonly ttsTransport: AiTtsTransport | "";
  readonly ttsVoice: string;
  readonly supportsJsonObject: boolean;
  readonly supportsJsonSchema: boolean;
}

const emptyDraft: AiDraft = {
  baseUrl: "",
  textModel: "",
  visionModel: "",
  asrModel: "",
  asrTransport: "audio-transcriptions",
  ttsModel: "",
  ttsTransport: "",
  ttsVoice: "",
  supportsJsonObject: false,
  supportsJsonSchema: false,
};

const probeCapabilities: readonly AiCapability[] = ["text", "vision", "asr", "tts"];

const capabilityCopy: Readonly<Record<AiCapability, { readonly title: string; readonly detail: string }>> = {
  text: { title: "文本", detail: "使用不含个人数据的小型内置夹具" },
  vision: { title: "视觉", detail: "使用内置图片夹具独立测试" },
  asr: { title: "语音识别", detail: "使用内置短音频夹具独立测试" },
  tts: { title: "视频配音", detail: "使用短句真实请求并在本机丢弃测试音频" },
};

function draftFromPreset(preset: AiProviderPreset): AiDraft {
  return {
    baseUrl: preset.baseUrl,
    textModel: preset.textModel,
    visionModel: preset.visionModel,
    asrModel: preset.asrModel,
    asrTransport: preset.asrTransport,
    ttsModel: preset.ttsModel,
    ttsTransport: preset.ttsTransport,
    ttsVoice: preset.ttsVoice,
    supportsJsonObject: preset.supportsJsonObject,
    supportsJsonSchema: preset.supportsJsonSchema,
  };
}

function draftFromConfig(config: PublicAiConnectionConfig | undefined): AiDraft {
  if (!config) return emptyDraft;
  return {
    baseUrl: config.baseUrl,
    textModel: config.textModel ?? "",
    visionModel: config.visionModel ?? "",
    asrModel: config.asrModel ?? "",
    asrTransport: config.asrTransport,
    ttsModel: config.ttsModel ?? "",
    ttsTransport: config.ttsTransport ?? "",
    ttsVoice: config.ttsVoice ?? "",
    supportsJsonObject: config.supportsJsonObject,
    supportsJsonSchema: config.supportsJsonSchema,
  };
}

function matchingPreset(draft: AiDraft): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => JSON.stringify(draftFromPreset(preset)) === JSON.stringify(draft));
}

function inputFromDraft(draft: AiDraft): AiConnectionPublicInput {
  return {
    baseUrl: draft.baseUrl,
    textModel: draft.textModel,
    visionModel: draft.visionModel,
    asrModel: draft.asrModel,
    asrTransport: draft.asrTransport,
    ttsModel: draft.ttsModel,
    ttsTransport: draft.ttsTransport || null,
    ttsVoice: draft.ttsVoice,
    supportsJsonObject: draft.supportsJsonObject,
    supportsJsonSchema: draft.supportsJsonSchema,
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
  if (typeof document !== "undefined") document.getElementById("ai-preset-key")?.focus();
}

export function AiSettingsPage({ runtime, navigate }: AiSettingsPageProps) {
  const [draft, setDraft] = useState<AiDraft>(emptyDraft);
  const [connection, setConnection] = useState<PublicAiConnectionConfig>();
  const [apiKey, setApiKey] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<AiProviderPreset["id"]>("xiaomi-mimo");
  const [probes, setProbes] = useState<readonly AiCapabilityProbeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState<AiCapability>();
  const [readIssue, setReadIssue] = useState<TaskIssue>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const connectionBusy = saving || probing !== undefined;
  const probeBlocked = connectionBusy || hasUnsavedProbeInputs(draft, connection, apiKey);
  const preset = AI_PROVIDER_PRESETS.find((item) => item.id === selectedPreset) ?? AI_PROVIDER_PRESETS[0]!;
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setReadIssue(undefined);
    try {
      const [config, results] = await Promise.all([
        runtime.aiSettings.getPublic(),
        runtime.aiSettings.getProbeResults(),
      ]);
      if (!mountedRef.current) return;
      const nextDraft = draftFromConfig(config);
      setConnection(config);
      setDraft(nextDraft);
      setSelectedPreset(matchingPreset(nextDraft)?.id ?? "xiaomi-mimo");
      setProbes(results);
    } catch (error) {
      if (!mountedRef.current) return;
      setReadIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "AI 设置暂时无法读取", action: "none" }));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const persist = async (nextDraft: AiDraft): Promise<PublicAiConnectionConfig> => {
    const saved = await runtime.aiSettings.save(inputFromDraft(nextDraft));
    if (apiKey.trim()) {
      await runtime.aiSettings.replaceApiKey(apiKey);
      setApiKey("");
      setReadIssue(undefined);
      return { ...saved, hasApiKey: true };
    }
    setReadIssue(undefined);
    return saved;
  };

  const runProbe = async (capability: AiCapability): Promise<AiCapabilityProbeResult | undefined> => {
    setProbing(capability);
    setIssue(undefined);
    try {
      const result = await runtime.aiSettings.probe(capability);
      if (!mountedRef.current) return result;
      setProbes((current) => [...current.filter((item) => item.capability !== capability), result]);
      return result;
    } catch (error) {
      if (!mountedRef.current) return undefined;
      setIssue(issueFromAppError(error, { code: "AI_CAPABILITY_PROBE_FAILED", message: "AI 能力探测未完成", action: "none" }));
      return undefined;
    } finally {
      if (mountedRef.current) setProbing(undefined);
    }
  };

  const probe = async (capability: AiCapability): Promise<AiCapabilityProbeResult | undefined> => {
    // Manual probe requests must never observe a connection which is still being
    // edited. The post-save four-capability sequence deliberately calls
    // runProbe directly after its new connection and Key have been persisted.
    if (probeBlocked) return undefined;
    return runProbe(capability);
  };

  const savePreset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connectionBusy) return;
    const nextDraft = draftFromPreset(preset);
    setSaving(true);
    setIssue(undefined);
    setSavedMessage(undefined);
    try {
      const saved = await persist(nextDraft);
      setDraft(nextDraft);
      setConnection(saved);
      setProbes([]);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_SETTINGS_INVALID", message: "一键配置未完成", action: "configure_ai" }));
      return;
    } finally {
      setSaving(false);
    }

    const results: AiCapabilityProbeResult[] = [];
    for (const capability of probeCapabilities) {
      const result = await runProbe(capability);
      if (result) results.push(result);
    }
    if (!mountedRef.current) return;
    const failures = probeCapabilities.length - results.filter((result) => result.status === "succeeded").length;
    setSavedMessage(failures
      ? `已保存 ${preset.label} 的公开配置与受保护 API Key；${failures} 项真实能力检测未通过，请查看对应结果。`
      : "设置与密钥已经安全保存，文字、图片、语音识别和视频配音检测均已完成。");
  };

  const saveManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connectionBusy) return;
    setSaving(true);
    setIssue(undefined);
    setSavedMessage(undefined);
    try {
      const saved = await persist(draft);
      setConnection(saved);
      setProbes([]);
      setSavedMessage("公开配置已保存；API Key 不会显示或回传到页面。");
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "AI_SETTINGS_INVALID", message: "AI 设置保存失败", action: "configure_ai" }));
    } finally {
      setSaving(false);
    }
  };

  const showSkeleton = useSkeletonHold(loading);
  if (showSkeleton) {
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="AI 服务"><PageSkeleton layout="settings" /></AppShell>;
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="AI 服务">
      <div className="page-stack page-settings settings-form">
        {readIssue ? <IssueNotice issue={readIssue} /> : null}
        {issue ? <IssueNotice actions={{ configureAi: focusAiConnectionForm }} issue={issue} /> : null}

        <GlassCard className="settings-security-note" tone="soft">
          <Icon name="key" size={20} />
          <p>{connection?.hasApiKey ? "API Key 已写入设备安全存储。更换供应商或 Key 后，一键保存即可覆盖。" : "选择供应商后只需输入 API Key；它只会写入 Android Keystore。"}</p>
        </GlassCard>

        <form className="ai-preset-form" onSubmit={savePreset}>
          <GlassCard className="settings-form__card ai-preset-card">
            <div className="ai-preset-card__heading">
              <span className="settings-overline">一键配置</span>
              <h2>选择供应商，只填 API Key</h2>
              <p>系统会自动填好服务地址和各项模型，并实际检测文字、图片、语音识别与视频配音是否可用。</p>
            </div>
            <label className="settings-field" htmlFor="ai-preset-provider"><span>供应商 <em>必填</em></span><select id="ai-preset-provider" onChange={(event) => setSelectedPreset(event.target.value as AiProviderPreset["id"])} value={selectedPreset}>{AI_PROVIDER_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="ai-preset-models" aria-label={`${preset.label} 自动配置模型`}>
              <span><small>文本</small><strong>{preset.textModel}</strong></span>
              <span><small>视觉</small><strong>{preset.visionModel}</strong></span>
              <span><small>语音识别</small><strong>{preset.asrModel}</strong></span>
              <span><small>视频配音</small><strong>{preset.ttsModel}</strong></span>
            </div>
            <label className="settings-field" htmlFor="ai-preset-key"><span>API Key <small>仅写入，不会回显</small></span><input autoCapitalize="none" autoComplete="off" id="ai-preset-key" onChange={(event) => setApiKey(event.target.value)} placeholder={connection?.hasApiKey ? "已设置；留空则保持不变" : "输入后写入设备安全存储"} required={!connection?.hasApiKey} spellCheck={false} type="password" value={apiKey} /></label>
            <p className="field-hint"><Icon name="info" size={15} />视频渲染会直接使用这里配置的云端 TTS；旧的未配音模型连接才回退到 Android 系统语音。</p>
            <Button disabled={connectionBusy} size="lg" type="submit"><Icon name="check_circle" size={18} />{saving ? "正在保存" : "一键保存并检测"}</Button>
          </GlassCard>
        </form>

        {savedMessage ? <p className="settings-save-note"><Icon name="check_circle" size={16} />{savedMessage}</p> : null}

        <details className="settings-advanced-config">
          <summary>高级兼容配置（仅自定义供应商时使用）</summary>
          <form className="page-stack" onSubmit={saveManual}>
            <GlassCard className="settings-form__card">
              <label className="settings-field" htmlFor="ai-base-url"><span>Base URL <em>必填</em></span><input autoCapitalize="none" autoComplete="url" id="ai-base-url" inputMode="url" onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" required type="url" value={draft.baseUrl} /></label>
              <label className="settings-field" htmlFor="ai-text-model"><span>文本模型 <em>必填</em></span><input autoCapitalize="none" id="ai-text-model" onChange={(event) => setDraft((current) => ({ ...current, textModel: event.target.value }))} required value={draft.textModel} /></label>
              <label className="settings-field" htmlFor="ai-vision-model"><span>视觉模型</span><input autoCapitalize="none" id="ai-vision-model" onChange={(event) => setDraft((current) => ({ ...current, visionModel: event.target.value }))} value={draft.visionModel} /></label>
              <label className="settings-field" htmlFor="ai-asr-model"><span>ASR 模型</span><input autoCapitalize="none" id="ai-asr-model" onChange={(event) => setDraft((current) => ({ ...current, asrModel: event.target.value }))} value={draft.asrModel} /></label>
              <label className="settings-field" htmlFor="ai-asr-transport"><span>ASR 传输方式</span><select id="ai-asr-transport" onChange={(event) => setDraft((current) => ({ ...current, asrTransport: event.target.value as AiAsrTransport }))} value={draft.asrTransport}><option value="audio-transcriptions">Audio Transcriptions</option><option value="chat-input-audio">Chat Input Audio（MiMo）</option><option value="stepaudio-sse">StepAudio SSE（阶跃）</option></select></label>
              <label className="settings-field" htmlFor="ai-tts-model"><span>视频配音模型</span><input autoCapitalize="none" id="ai-tts-model" onChange={(event) => setDraft((current) => ({ ...current, ttsModel: event.target.value }))} value={draft.ttsModel} /></label>
              <label className="settings-field" htmlFor="ai-tts-transport"><span>TTS 传输方式</span><select id="ai-tts-transport" onChange={(event) => setDraft((current) => ({ ...current, ttsTransport: event.target.value as AiTtsTransport | "" }))} value={draft.ttsTransport}><option value="">不配置云端 TTS（使用系统语音）</option><option value="mimo-chat-audio">MiMo Chat Audio</option><option value="stepfun-audio-speech">StepFun Audio Speech</option></select></label>
              <label className="settings-field" htmlFor="ai-tts-voice"><span>TTS 音色</span><input autoCapitalize="none" id="ai-tts-voice" onChange={(event) => setDraft((current) => ({ ...current, ttsVoice: event.target.value }))} value={draft.ttsVoice} /></label>
            </GlassCard>

            <GlassCard className="settings-form__card settings-switches">
              <label className="switch-row"><span><strong>JSON Object</strong><small>供应商支持 JSON Object 输出时启用</small></span><input checked={draft.supportsJsonObject} onChange={(event) => setDraft((current) => ({ ...current, supportsJsonObject: event.target.checked }))} type="checkbox" /></label>
              <label className="switch-row"><span><strong>JSON Schema</strong><small>供应商支持 JSON Schema 输出时启用</small></span><input checked={draft.supportsJsonSchema} onChange={(event) => setDraft((current) => ({ ...current, supportsJsonSchema: event.target.checked }))} type="checkbox" /></label>
            </GlassCard>
            <Button disabled={connectionBusy} size="lg" type="submit"><Icon name="check_circle" size={18} />{saving ? "正在保存" : "保存高级配置"}</Button>
          </form>
        </details>

        <section className="settings-probes" aria-labelledby="ai-probe-title">
          <div className="settings-probes__heading"><div><span className="settings-overline">连接检测</span><h2 id="ai-probe-title">文字、图片、语音识别与视频配音</h2></div>{readIssue ? <Button disabled={connectionBusy} onClick={() => void load()} size="md" variant="quiet"><Icon name="sync" size={16} />刷新</Button> : null}</div>
          {probeBlocked && !connectionBusy ? <p className="field-hint"><Icon name="info" size={15} />请先保存当前 AI 设置后再测试；测试只会使用已写入本机安全存储的连接。</p> : null}
          <div className="probe-list">
            {probeCapabilities.map((capability) => {
              const result = probes.find((item) => item.capability === capability);
              const copy = capabilityCopy[capability];
              return (
                <GlassCard className="probe-row" key={capability}>
                  <span className={`probe-row__status ${result ? `is-${result.status}` : ""}`.trim()}><Icon name={result?.status === "succeeded" ? "check_circle" : "pending"} size={19} /></span>
                  <div><strong>{copy.title}</strong><small>{result?.model ?? copy.detail}</small>{result?.issue ? <em>{result.issue.userMessage}</em> : null}</div>
                  <div className="probe-row__action mobile-action-group"><span>{probeLabel(result)}</span><Button disabled={probeBlocked} onClick={() => void probe(capability)} size="md" variant="secondary">{probing === capability ? "测试中" : "测试"}</Button></div>
                </GlassCard>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
