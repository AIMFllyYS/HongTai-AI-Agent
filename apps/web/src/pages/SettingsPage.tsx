import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { useAppResume } from "../hooks/useAppResume";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, BackgroundRunStatusV1, LocalProfile, PublicAiConnectionConfig, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { Icon, type IconName } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { Sheet } from "../components/Sheet";
import { Switch } from "../components/Switch";
import { type ColorSchemePreference, applyStoredAppearancePreferences, colorSchemeLabel, readAppearancePreferences, writeAppearancePreferences } from "../runtime/appearance-preferences";
import { readBackgroundRunPreferences, writeBackgroundRunPreferences } from "../runtime/background-run-preferences";
import { aiSettingsPath, appInfoSettingsPath, profileSettingsPath, storageAnalysisPath } from "../router";
import { settingsRowGlyphs } from "../playbook/document-sections";

export interface SettingsPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

interface SettingsSnapshot {
  readonly profile: LocalProfile | undefined;
  readonly aiConnection: PublicAiConnectionConfig | undefined;
  readonly versionName: string | undefined;
}

type SettingsSheet = "scheme" | "theme" | "privacy" | undefined;

function profileDetail(profile: LocalProfile | undefined): string {
  if (!profile) return "尚未建立本地档案";
  return [profile.businessName, profile.industry].filter((value): value is string => Boolean(value)).join(" · ") || "名字、门店与经营标签";
}

function aiServiceDetail(connection: PublicAiConnectionConfig | undefined): string {
  const model = connection?.textModel ?? "尚未填写文本模型";
  return connection?.hasApiKey ? `${model} · 已连接` : `${model} · 尚未写入密钥`;
}

function batteryOptimizationDetail(status: BackgroundRunStatusV1 | undefined): string {
  if (!status) return "读取中";
  return status.batteryOptimizationIgnored ? "已豁免省电限制" : "受系统省电限制";
}

function notificationPermissionDetail(status: BackgroundRunStatusV1 | undefined): string {
  const permission = status?.notificationPermission;
  if (permission === "granted") return "已授权";
  if (permission === "denied") return "已拒绝，去系统设置开启";
  if (permission === "prompt") return "未授权";
  return "未知";
}

function Avatar({ profile, size }: { readonly profile: LocalProfile | undefined; readonly size: "masthead" | "row" }) {
  const name = profile?.displayName?.trim();
  const initial = name ? Array.from(name)[0] ?? "宏" : "宏";
  if (profile?.avatarUri) {
    return <img alt={`${profile.displayName}的头像`} className={`runtime-avatar runtime-avatar--${size}`} src={profile.avatarUri} />;
  }
  return <span aria-hidden="true" className={`runtime-avatar runtime-avatar--${size} runtime-avatar--empty`}>{initial}</span>;
}

function SettingsRow({
  icon,
  title,
  value,
  onClick,
  trailing,
  titleId,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly value?: string;
  readonly onClick?: () => void;
  readonly trailing?: ReactNode;
  readonly titleId?: string;
}) {
  const content = (
    <>
      <Icon className="settings-row__glyph" name={icon} size={19} />
      <span className="settings-row__title" id={titleId}>{title}</span>
      {value ? <span className="settings-row__value">{value}</span> : null}
      {trailing ?? <Icon className="settings-row__chevron" name="chevron_right" size={16} />}
    </>
  );
  if (onClick) {
    return <button className="settings-row" onClick={onClick} type="button">{content}</button>;
  }
  return <div className="settings-row">{content}</div>;
}

export function SettingsPage({ runtime, navigate }: SettingsPageProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>();
  const [issue, setIssue] = useState<TaskIssue>();
  const [prefs, setPrefs] = useState(readAppearancePreferences);
  const [sheet, setSheet] = useState<SettingsSheet>();
  const [backgroundRunEnabled, setBackgroundRunEnabled] = useState(readBackgroundRunPreferences().enabled);
  const [backgroundRunStatus, setBackgroundRunStatus] = useState<BackgroundRunStatusV1>();
  const backgroundRunAvailable = runtime.features.backgroundRun === "available";

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

  const refreshBackgroundRunStatus = useCallback(async () => {
    if (!backgroundRunAvailable) return;
    try {
      setBackgroundRunStatus(await runtime.backgroundRun.getStatus());
    } catch {
      // 实测状态读取失败时保留上次值；不阻塞设置页其他资料。
    }
  }, [backgroundRunAvailable, runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshBackgroundRunStatus();
  }, [refreshBackgroundRunStatus]);

  // 电池优化跳转的是系统设置页：返回本应用后在此重读实测状态。
  useAppResume(() => { void refreshBackgroundRunStatus(); });

  useEffect(() => {
    applyStoredAppearancePreferences();
  }, []);

  const setAlertsEnabled = (alertsEnabled: boolean) => {
    setPrefs(writeAppearancePreferences({ ...prefs, alertsEnabled }));
  };

  const toggleBackgroundRun = (enabled: boolean) => {
    setBackgroundRunEnabled(writeBackgroundRunPreferences({ enabled }).enabled);
    void runtime.backgroundRun.setEnabled(enabled).then(refreshBackgroundRunStatus);
  };

  const openBatteryOptimizationSettings = () => {
    void runtime.backgroundRun.requestIgnoreBatteryOptimizations()
      .then(refreshBackgroundRunStatus)
      .catch((error: unknown) => {
        setIssue(issueFromAppError(error, {
          code: "APP_RUNTIME_UNAVAILABLE",
          message: "未能打开电池优化设置",
          action: "none",
        }));
      });
  };

  const requestNotificationPermission = () => {
    void runtime.backgroundRun.requestNotificationPermission()
      .then(refreshBackgroundRunStatus)
      .catch((error: unknown) => {
        setIssue(issueFromAppError(error, {
          code: "APP_RUNTIME_UNAVAILABLE",
          message: "未能请求通知权限",
          action: "none",
        }));
      });
  };

  const setColorScheme = (colorScheme: ColorSchemePreference) => {
    setPrefs(writeAppearancePreferences({ ...prefs, colorScheme }));
    setSheet(undefined);
  };

  const showSkeleton = useSkeletonHold(!snapshot && !issue);
  if (showSkeleton) {
    return (
      <AppShell activeNav="settings" navigate={navigate} title="设置">
        <PageSkeleton layout="settings" />
      </AppShell>
    );
  }

  const profile = snapshot?.profile;
  const aiConnection = snapshot?.aiConnection;
  const profileName = profile?.displayName ?? "建立本地档案";
  const versionLabel = snapshot?.versionName ? `版本 ${snapshot.versionName}` : "查看当前版本号";

  return (
    <AppShell activeNav="settings" navigate={navigate} title="设置">
      <div className="page-stack page-settings settings-summary">
        {issue ? <IssueNotice issue={issue} /> : null}

        <button className="settings-profile-row" onClick={() => navigate(profileSettingsPath())} type="button">
          <Avatar profile={profile} size="row" />
          <span className="settings-profile-row__body">
            <strong>{profileName}</strong>
            <small>{profileDetail(profile)}</small>
          </span>
          <Icon className="settings-row__chevron" name="chevron_right" size={16} />
        </button>

        <section className="settings-section">
          <p className="settings-group-label">通用</p>
          <div className="settings-list">
            <SettingsRow icon={settingsRowGlyphs.profile} onClick={() => navigate(profileSettingsPath())} title="我的资料" value="名字、门店与经营标签" />
            <SettingsRow icon={settingsRowGlyphs.ai} onClick={() => navigate(aiSettingsPath())} title="AI 服务" value={aiServiceDetail(aiConnection)} />
            <SettingsRow
              icon={settingsRowGlyphs.alerts}
              title="通知提醒"
              titleId="settings-alerts"
              trailing={<Switch checked={prefs.alertsEnabled} labelledBy="settings-alerts" onChange={setAlertsEnabled} />}
            />
          </div>
        </section>

        {backgroundRunAvailable ? (
          <section className="settings-section">
            <p className="settings-group-label">运行</p>
            <div className="settings-list">
              <SettingsRow
                icon={settingsRowGlyphs.backgroundRun}
                title="后台运行"
                titleId="settings-background-run"
                trailing={<Switch checked={backgroundRunEnabled} labelledBy="settings-background-run" onChange={toggleBackgroundRun} />}
              />
              <SettingsRow
                icon={settingsRowGlyphs.battery}
                onClick={openBatteryOptimizationSettings}
                title="电池优化"
                value={batteryOptimizationDetail(backgroundRunStatus)}
              />
              <SettingsRow
                icon={settingsRowGlyphs.alerts}
                onClick={requestNotificationPermission}
                title="后台运行通知"
                value={notificationPermissionDetail(backgroundRunStatus)}
              />
            </div>
            <p className="settings-footnote">
              开启后，制作、采集、拆解与观察任务在熄屏或切后台时继续运行；关闭则保持屏幕常亮推进任务。
              长时间熄屏静置或部分手机的省电策略仍可能暂停任务，长任务建议保持充电。
            </p>
          </section>
        ) : null}

        <section className="settings-section">
          <p className="settings-group-label">外观</p>
          <div className="settings-list">
            <SettingsRow icon={settingsRowGlyphs.scheme} onClick={() => setSheet("scheme")} title="深色模式" value={colorSchemeLabel(prefs.colorScheme)} />
            <SettingsRow
              icon={settingsRowGlyphs.theme}
              onClick={() => setSheet("theme")}
              title="主题色"
              trailing={<><span className="settings-color-dot" /><Icon className="settings-row__chevron" name="chevron_right" size={16} /></>}
            />
          </div>
        </section>

        <section className="settings-section">
          <p className="settings-group-label">数据</p>
          <div className="settings-list">
            <SettingsRow icon={settingsRowGlyphs.storage} onClick={() => navigate(storageAnalysisPath())} title="存储管理" value="查看存储占用" />
          </div>
        </section>

        <section className="settings-section">
          <p className="settings-group-label">其他</p>
          <div className="settings-list">
            <SettingsRow icon={settingsRowGlyphs.about} onClick={() => navigate(appInfoSettingsPath())} title="关于" value={versionLabel} />
            <SettingsRow icon={settingsRowGlyphs.privacy} onClick={() => setSheet("privacy")} title="隐私说明" />
          </div>
        </section>

        <p className="settings-footnote">资料与 AI 配置都保存在本机应用数据中；访问密钥写入 Android Keystore，不会上传。</p>

        {issue ? <Button onClick={() => void load()} variant="quiet"><Icon name="sync" size={17} />重新读取</Button> : null}

        <Sheet onClose={() => setSheet(undefined)} open={sheet === "scheme"} title="深色模式">
          <div className="sheet-action-list">
            {(["system", "light", "dark"] as const).map((scheme) => (
              <button className={`settings-choice ${prefs.colorScheme === scheme ? "is-selected" : ""}`.trim()} key={scheme} onClick={() => setColorScheme(scheme)} type="button">
                {colorSchemeLabel(scheme)}
              </button>
            ))}
          </div>
        </Sheet>

        <Sheet onClose={() => setSheet(undefined)} open={sheet === "theme"} title="主题色">
          <p className="settings-sheet-copy">当前产品使用品牌绿，没有第二套主题色。</p>
          <span className="settings-color-swatch" />
        </Sheet>

        <Sheet onClose={() => setSheet(undefined)} open={sheet === "privacy"} title="隐私说明">
          <p className="settings-sheet-copy">图片、拆解任务和制作项目只保存在本机应用数据中。API Key 仅写入 Android Keystore，页面读不到原始密钥，也不会上传。</p>
        </Sheet>
      </div>
    </AppShell>
  );
}
