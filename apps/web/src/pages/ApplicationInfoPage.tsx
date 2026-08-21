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
  "到顶或到底再用力上下拉，页面不再整页拉伸或跟着晃动；正常上下惯性滚动依旧顺畅，也没有上拉刷新。",
  "深色模式补全淡绿底、状态软底与观察纸面配色，系统深色下的冷启动开屏画面更统一。",
  "确认使用图片后直接进入「AI 正在观察」进行中页，可看到真实扫光与运行期深度思考，生成完成后自动切到报告。",
  "观察报告详情页改为底部胶囊追问输入，发出问题后上滑「AI 追问」悬浮窗，回复支持 Markdown 渲染与一键复制原文。",
  "每个安装版本仍会单独保留，这次更新可以覆盖安装，不会覆盖以前的安装包文件。",
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
