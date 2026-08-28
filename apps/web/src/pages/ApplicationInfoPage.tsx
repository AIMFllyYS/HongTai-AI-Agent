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
  "制作改成一步一步来：先写一句话需求，AI 流式写出逐句分镜文稿，逐句核对后再配音、合成，每个阶段只做一件事，进度随时看得见。",
  "不用再预先选视频时长：时长由文稿和真实配音音频决定，总时长超出 15–60 秒会提示回改或确认后继续，不再强制四选一。",
  "分镜卡片支持逐句编辑：改文案、换素材、调贴纸都在卡片上就地完成；改了哪句只重新配那一句，其余句子保持已就绪不用重来。",
  "字幕时间跟着真实语音走：优先按实际读出的时间对齐，机器对不上的句子会如实标注精度差异，不再按字数估算。",
  "「数字人」模式改名「口播切片」，能力不变；旧版本制作的存量项目仍可打开并重新出片。",
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
