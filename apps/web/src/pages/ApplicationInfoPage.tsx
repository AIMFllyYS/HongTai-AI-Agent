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
  "冷启动先显示项目图标和浅色开屏，大约两三秒后再进入内容。",
  "制作完成后，即使页面通知出错，也不会把已经成功的成片改成失败。",
  "深度思考和第一块正式内容之间留出缝隙，不再贴在一起。",
  "键盘弹出时输入框会跟着抬高；底栏不再贴到系统手势条上。",
  "打开应用更轻：非首页按需载入，中文字体也收成界面用字。",
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
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="关于"><LoadingState description="正在读取版本信息" title="加载应用信息" /></AppShell>;
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

          <section className="settings-update-list">
            <div className="section-heading"><div><h2>新版本改了什么</h2></div><span className="analysis-count">v{info.versionName}</span></div>
            {latestUpdates.map((item, index) => <GlassCard className="settings-update-item" key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></GlassCard>)}
          </section>
        </> : null}
      </div>
    </AppShell>
  );
}
