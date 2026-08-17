import { useCallback, useEffect, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppBuildInfo, AppRuntime, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { LoadingState } from "../components/StatePanels";

export interface ApplicationInfoPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

const latestUpdates = [
  "拆解首页用「粘贴链接 / 上传视频」切换来源，结果页在同一处看原文和拆解。",
  "制作页改为竖屏预览和按阶段变化的唯一主按钮，完成后不会出现未接入的发布入口。",
  "底栏回到五项；富迪素材库改到制作页右上角，点了没反应的通知铃已去掉。",
  "合成失败会说明更具体的原因，并可从制作页重试；纯图片工程不再被要求更换 MP4。",
  "启动图标改为分层图标，减少桌面白边；模板删除按钮在窄屏下不再被拉成大圆。",
  "每个安装版本都会单独保留，更新时不会覆盖以前的安装包。",
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

  if (!info && !issue) {
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="应用信息"><LoadingState description="正在读取版本信息" title="加载应用信息" /></AppShell>;
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="应用信息">
      <div className="page-stack page-settings settings-detail">
        {issue ? <IssueNotice issue={issue} /> : null}
        {info ? <>
          <GlassCard className="settings-detail-card settings-app-info-card">
            <span className="settings-detail-card__icon"><Icon name="info" size={25} /></span>
            <div>
              <span className="settings-overline">HongTai AI Agent</span>
              <h2>版本 {info.versionName}</h2>
              <p>本机构建号 {info.versionCode}</p>
            </div>
          </GlassCard>

          <section className="settings-update-list">
            <div className="section-heading"><div><span className="eyebrow">LATEST UPDATE</span><h2>最近更新</h2></div><span className="analysis-count">v{info.versionName}</span></div>
            {latestUpdates.map((item, index) => <GlassCard className="settings-update-item" key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></GlassCard>)}
          </section>
        </> : null}
      </div>
    </AppShell>
  );
}
