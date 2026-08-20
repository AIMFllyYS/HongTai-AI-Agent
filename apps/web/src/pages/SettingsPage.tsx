import { useCallback, useEffect, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, LocalProfile, PublicAiConnectionConfig, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { LoadingState } from "../components/StatePanels";
import { SectionHeading } from "../components/Headings";
import { aiSettingsPath, appInfoSettingsPath, profileSettingsPath } from "../router";

export interface SettingsPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

interface SettingsSnapshot {
  readonly profile: LocalProfile | undefined;
  readonly aiConnection: PublicAiConnectionConfig | undefined;
  readonly versionName: string | undefined;
}

function profileDetail(profile: LocalProfile | undefined): string {
  if (!profile) return "尚未建立本地档案";
  return [profile.businessName, profile.industry].filter((value): value is string => Boolean(value)).join(" · ") || "名字、门店与经营标签";
}

function aiServiceDetail(connection: PublicAiConnectionConfig | undefined): string {
  const model = connection?.textModel ?? "尚未填写文本模型";
  return connection?.hasApiKey ? `${model} · 已连接` : `${model} · 尚未写入密钥`;
}

function Avatar({ profile }: { readonly profile: LocalProfile | undefined }) {
  if (profile?.avatarUri) {
    return <img alt={`${profile.displayName}的头像`} className="runtime-avatar" src={profile.avatarUri} />;
  }
  return <span aria-hidden="true" className="runtime-avatar runtime-avatar--empty"><Icon name="face" size={28} /></span>;
}

export function SettingsPage({ runtime, navigate }: SettingsPageProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [issue, setIssue] = useState<TaskIssue>();

  const load = useCallback(async () => {
    setIssue(undefined);
    try {
      const [profile, aiConnection, appInfo] = await Promise.all([
        runtime.profile.get(),
        runtime.aiSettings.getPublic(),
        runtime.deviceSettings.getAppInfo(),
      ]);
      setSnapshot({ profile, aiConnection, versionName: appInfo.versionName });
    } catch (error) {
      setIssue(issueFromAppError(error, {
        code: "APP_RUNTIME_UNAVAILABLE",
        message: "设置资料暂时无法读取",
        action: "none",
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!snapshot && !issue) {
    return (
      <AppShell activeNav="settings" navigate={navigate} subtitle="资料与 AI 配置都保存在本机" title="设置">
        <LoadingState description="正在读取本机档案与 AI 设置" title="加载设置" />
      </AppShell>
    );
  }

  const profile = snapshot?.profile;
  const aiConnection = snapshot?.aiConnection;
  const profileName = profile?.displayName ?? "建立本地档案";
  const versionLabel = snapshot?.versionName ? `版本 ${snapshot.versionName}` : "查看当前版本号与最近更新";

  return (
    <AppShell activeNav="settings" navigate={navigate} subtitle="资料与 AI 配置都保存在本机" title="设置">
      <div className="page-stack page-settings settings-summary">
        {issue ? <IssueNotice issue={issue} /> : null}

        <GlassCard className="settings-profile-overview" onClick={() => navigate(profileSettingsPath())}>
          <Avatar profile={profile} />
          <div className="settings-profile-overview__body">
            <h2>{profileName}</h2>
            <p>{profileDetail(profile)}</p>
          </div>
          <Icon className="settings-row__chevron" name="chevron_right" size={19} />
        </GlassCard>

        <section className="settings-section">
          <SectionHeading title="通用" />
          <GlassCard className="settings-card">
            <button className="settings-row" onClick={() => navigate(profileSettingsPath())} type="button">
              <span className="settings-row__icon"><Icon name="business_center" size={19} /></span>
              <span className="settings-row__body"><strong>我的资料</strong><small>名字、门店与经营标签</small></span>
              <Icon className="settings-row__chevron" name="chevron_right" size={17} />
            </button>
            <button className="settings-row" onClick={() => navigate(aiSettingsPath())} type="button">
              <span className="settings-row__icon settings-row__icon--key"><Icon name="key" size={19} /></span>
              <span className="settings-row__body"><strong>AI 服务</strong><small>{aiServiceDetail(aiConnection)}</small></span>
              <Icon className="settings-row__chevron" name="chevron_right" size={17} />
            </button>
          </GlassCard>
        </section>

        <section className="settings-section">
          <SectionHeading title="其他" />
          <GlassCard className="settings-card">
            <button className="settings-row" onClick={() => navigate(appInfoSettingsPath())} type="button">
              <span className="settings-row__icon"><Icon name="info" size={19} /></span>
              <span className="settings-row__body"><strong>关于</strong><small>{versionLabel}</small></span>
              <Icon className="settings-row__chevron" name="chevron_right" size={17} />
            </button>
          </GlassCard>
        </section>

        <GlassCard className="settings-security-note" tone="soft">
          <Icon name="key" size={20} />
          <p>本地档案与公开 AI 配置保存在本机应用数据中；API Key 仅写入 Android Keystore，不会回传到页面。</p>
        </GlassCard>

        {issue ? <Button onClick={() => void load()} variant="quiet"><Icon name="sync" size={17} />重新读取</Button> : null}
      </div>
    </AppShell>
  );
}
