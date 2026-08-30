import { useCallback, useEffect, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppBuildInfo, AppRuntime, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { playbookPath, updateLogSettingsPath } from "../router";

export interface ApplicationInfoPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

const latestUpdates = [
  "任务不怕熄屏和切后台：制作、采集、拆解、观察运行时会出现「后台运行中」常驻通知，任务在后台继续推进，回到应用即可查看进度。",
  "设置新增「后台运行」区：可随时开关后台运行；开启后任务运行期间允许屏幕熄灭，更省电。",
  "电池优化引导：设置页可一键申请豁免电池优化（含系统设置兜底路径），降低长任务被系统省电策略暂停的概率。",
  "后台运行通知权限：Android 13 及以上可在设置页查看并授权通知权限，未授权时后台服务仍运行但通知不显示。",
  "诚实边界：长时间熄屏静置或部分手机的激进省电策略仍可能暂停任务，长任务建议保持充电；关闭开关后回到屏幕常亮推进的原行为。",
] as const;

export function ApplicationInfoPage({ runtime, navigate }: ApplicationInfoPageProps) {
  const [info, setInfo] = useState<AppBuildInfo>();
  const [issue, setIssue] = useState<TaskIssue>();

  const load = useCallback(async () => {
    setIssue(undefined);
    try {
      setInfo(await runtime.deviceSettings.getAppInfo());
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "应用信息暂时不可读取", action: "none" }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const showSkeleton = useSkeletonHold(!info && !issue);
  if (showSkeleton) {
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="关于"><PageSkeleton layout="settings" /></AppShell>;
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="关于">
      <div className="page-stack page-settings settings-detail">
        {issue ? <IssueNotice issue={issue} /> : null}
        {info ? <>
          <GlassCard className="settings-detail-card settings-app-info-card">
            <span className="settings-detail-card__icon"><Icon name="info" size={25} /></span>
            <div>
              <span className="settings-overline">宏泰 AI 智能体</span>
              <h2>版本 {info.versionName}</h2>
              <p>本机构建号 {info.versionCode}</p>
            </div>
          </GlassCard>

          <section className="settings-section">
            <div className="settings-list">
              <button className="settings-row" onClick={() => navigate(updateLogSettingsPath())} type="button">
                <Icon className="settings-row__glyph" name="history" size={19} />
                <span className="settings-row__title">更新日志</span>
                <span className="settings-row__value">官方站点</span>
                <Icon className="settings-row__chevron" name="chevron_right" size={16} />
              </button>
              <button className="settings-row" onClick={() => navigate(playbookPath())} type="button">
                <Icon className="settings-row__glyph" name="layout_template" size={19} />
                <span className="settings-row__title">设计稿对照</span>
                <span className="settings-row__value">页面层板块</span>
                <Icon className="settings-row__chevron" name="chevron_right" size={16} />
              </button>
            </div>
          </section>

          <section className="settings-update-list">
            <div className="section-heading"><div><h2>本版要点</h2></div><span className="analysis-count">v{info.versionName}</span></div>
            {latestUpdates.map((item, index) => <GlassCard className="settings-update-item" key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></GlassCard>)}
          </section>
        </> : null}
      </div>
    </AppShell>
  );
}
