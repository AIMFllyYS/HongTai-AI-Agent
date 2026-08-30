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
  "智能成片修好了：一句话需求直接开始，不再误报「制作项目不存在或已损坏」；新建就是全新项目，不再混入旧项目的内容和报错。",
  "数字人先传视频再制作：打开「数字人出镜」就能直接上传数字人视频，上传后一键制作才启动，不再白跑一趟。",
  "看得见 AI 在想什么：分镜脚本生成时实时流出 AI 的深度思考过程，进度不再靠猜。",
  "删除确认统一了：项目、素材、成片、任务、模板的删除都从底部弹出确认层，删除是不可逆操作，确认按钮改成警示红色。",
  "错误不再重复刷屏：同一错误只在一个地方说清楚；生成中按钮如实显示「正在生成」，列表底部不再被悬浮按钮挡住。",
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
