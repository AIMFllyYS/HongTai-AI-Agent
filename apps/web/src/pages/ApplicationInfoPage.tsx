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
  "制作页改成可点击的五步步骤导航：需求、分镜文稿、配音、合成、成片一步点亮一步，做完的步骤可以随时点回去修改，不用再在长页面里上下翻找。",
  "生成进度看得见：分镜脚本生成时逐句点亮卡片，完成一句亮一句，屏幕上不再出现技术原文。",
  "深度思考默认折叠：想看 AI 推理过程再点开，面板宽度与其他卡片对齐，页面更整齐。",
  "删除项目收进页头「更多」菜单：不再在内容区裸露，删除前仍需在底部弹层里确认，防止误删。",
  "贴纸默认放在右上角安全区：不再默认压在人物脸部附近，成片观感更干净。",
  "界面元素触控区域加大：按钮、开关、下拉等更好点，减少误触。",
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
