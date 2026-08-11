import { useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";

export interface TtsSettingsPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

export function TtsSettingsPage({ runtime, navigate }: TtsSettingsPageProps) {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [issue, setIssue] = useState<TaskIssue>();

  const openSystemSettings = async () => {
    if (opening) return;
    setOpening(true);
    setOpened(false);
    setIssue(undefined);
    try {
      await runtime.deviceSettings.openTextToSpeechSettings();
      setOpened(true);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "系统 TTS 设置暂时不可打开", action: "none" }));
    } finally {
      setOpening(false);
    }
  };

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="TTS 语音合成">
      <div className="page-stack page-settings settings-detail">
        {issue ? <IssueNotice issue={issue} /> : null}

        <GlassCard className="settings-detail-card settings-tts-card">
          <span className="settings-detail-card__icon"><Icon name="record_voice_over" size={25} /></span>
          <div>
            <span className="settings-overline">本地合成配音</span>
            <h2>使用 Android 系统 TTS</h2>
            <p>“素材剪辑 + TTS”会用设备的中文系统语音生成旁白，并与本地字幕一起合成到视频；不会改用云端 TTS 或伪造配音成功。</p>
          </div>
        </GlassCard>

        <GlassCard className="settings-form__card settings-tts-facts">
          <div><strong>语言</strong><small>制作计划请求中文（zh-CN）系统语音</small></div>
          <div><strong>引擎与语音包</strong><small>由 Android 系统 TTS 设置决定；应用会优先使用已安装的兼容中文语音</small></div>
          <div><strong>旁白语速</strong><small>由已验证的制作计划在 0.75–1.25 范围内确定，不伪造未实际生效的页面开关</small></div>
          <div><strong>生效方式</strong><small>返回应用后重新发起本地合成，已生成的成片不会被改写</small></div>
        </GlassCard>

        {opened ? <p className="settings-save-note"><Icon name="check_circle" size={16} />已打开 Android 系统 TTS 设置；完成配置后返回本应用即可。</p> : null}
        <Button disabled={opening} onClick={() => void openSystemSettings()} size="lg"><Icon name="tune" size={18} />{opening ? "正在打开系统设置" : "配置系统 TTS"}</Button>
      </div>
    </AppShell>
  );
}
