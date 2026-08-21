import { useCallback, useEffect, useState } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppBuildInfo, AppRuntime, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { playbookPath } from "../router";

export interface ApplicationInfoPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

const latestUpdates = [
  "点底栏加号进入「智能成片」或「爆款复刻」时，会打开制作页，不再变成「页面不存在」。",
  "拆解首页切到「上传视频」后，选择说明会显示成完整卡片，图标和文字不会挤成一小条。",
  "底栏中间加号改成更小的方圆钮，和左右四个入口对齐；点开后可以新建成片、复刻或拆解链接。",
  "模板页可以按名称搜索本机精选，空状态说明改成一行，不再折成两截。",
  "观察采集卡加上镭射扫光，拍摄说明贴在画面底部；页头头像描边改为纯白。",
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

          <section className="settings-update-list">
            <div className="section-heading"><div><h2>新版本改了什么</h2></div><span className="analysis-count">v{info.versionName}</span></div>
            {latestUpdates.map((item, index) => <GlassCard className="settings-update-item" key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></GlassCard>)}
          </section>

          <button className="settings-row" onClick={() => navigate(playbookPath())} type="button">
            <Icon className="settings-row__glyph" name="layout_template" size={19} />
            <span className="settings-row__title">设计稿对照</span>
            <span className="settings-row__value">页面层板块</span>
            <Icon className="settings-row__chevron" name="chevron_right" size={16} />
          </button>
        </> : null}
      </div>
    </AppShell>
  );
}
