import type { DiagnosisSessionRecord, StructuredGenerationProgressV1 } from "@hongtai/core";

import { Icon } from "../components/Icon";
import { PageSkeleton } from "../components/PageSkeleton";
import { ObservationObservingScreen } from "../features/diagnosis/observation-observing-screen";
import { OBSERVATION_FACE_SCAN_SRC } from "../features/diagnosis/observation-start-panels";
import { composeActions } from "../navigation/compose-actions";
import { primaryNavItems } from "../navigation/primary-nav";
import { analysisDocumentSections, observationReportSections, settingsRowGlyphs } from "./document-sections";

export function PlaybookTabBarSpecimen() {
  return (
    <div className="playbook-tabbar" aria-hidden="true">
      {primaryNavItems.slice(0, 2).map((item) => (
        <span className="playbook-tabbar__item" key={item.id}>
          <Icon name={item.icon} size={22} />
          {item.label}
        </span>
      ))}
      <span className="playbook-tabbar__item playbook-tabbar__item--plus">
        <span className="playbook-fab"><Icon name="plus" size={18} /></span>
      </span>
      {primaryNavItems.slice(2).map((item) => (
        <span className="playbook-tabbar__item" key={item.id}>
          <Icon name={item.icon} size={22} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function PlaybookNavBarSpecimen() {
  return (
    <div className="playbook-navbar">
      <Icon name="chevron_left" size={24} />
      <strong>页面标题</strong>
      <span className="playbook-navbar__slot" />
    </div>
  );
}

export function PlaybookPasteSpecimen() {
  return (
    <div className="playbook-phone">
      <p className="playbook-phone__title">拆解</p>
      <p className="playbook-phone__caption">让 AI 帮你看懂爆款逻辑</p>
      <div className="playbook-input">
        <Icon name="link" size={17} />
        <span>粘贴作品链接</span>
        <em>粘贴</em>
      </div>
      <p className="playbook-recognized"><Icon name="circle_check" size={15} />已识别 抖音 · 设计稿示例链接</p>
      <p className="playbook-hint">支持抖音、小红书、B站；快手仅支持公开单条链接（实验性）。</p>
    </div>
  );
}

export function PlaybookOverlaySpecimen() {
  return (
    <div className="playbook-overlay">
      <div className="playbook-overlay__page" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="playbook-overlay__scrim" />
      <PlaybookComposeSpecimen />
    </div>
  );
}

export function PlaybookSkeletonSpecimen() {
  return <PageSkeleton layout="home" />;
}

export function PlaybookComposeSpecimen() {
  return (
    <div className="playbook-sheet">
      <span className="playbook-sheet__handle" />
      <h3>新建</h3>
      {composeActions.map((action) => (
        <div className="playbook-sheet__row" key={action.id}>
          <span className="sheet-action__icon"><Icon name={action.icon} size={16} /></span>
          <div>
            <strong>{action.title}</strong>
            <small>{action.description}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlaybookAnalysisSpecimen() {
  return (
    <div className="playbook-doc-list">
      {analysisDocumentSections.map((section) => (
        <div className="playbook-doc-row" key={section.id}>
          <Icon name={section.icon} size={16} />
          <span>{section.title}</span>
        </div>
      ))}
    </div>
  );
}

export function PlaybookObservationSpecimen() {
  return (
    <div className="playbook-doc-list">
      {Object.values(observationReportSections).map((section) => (
        <div className="playbook-doc-row" key={section.title}>
          <Icon name={section.icon} size={16} />
          <span>{section.title}</span>
        </div>
      ))}
    </div>
  );
}

export function PlaybookFollowUpSpecimen() {
  return (
    <div className="playbook-overlay" aria-hidden="true">
      <div className="playbook-overlay__page">
        <span />
        <span />
        <span />
      </div>
      <div className="playbook-overlay__scrim" />
      <div className="observation-follow-up-sheet playbook-follow-up-sheet">
        <div className="observation-follow-up-sheet__head">
          <div className="observation-follow-up-sheet__grab">
            <div className="observation-follow-up-sheet__handle" />
            <div className="observation-follow-up-sheet__title">
              <Icon name="message_circle" size={18} />
              <strong>AI 追问</strong>
            </div>
          </div>
          <span className="icon-button observation-follow-up-sheet__close"><Icon name="close" size={20} /></span>
        </div>
        <div className="observation-follow-up-sheet__messages">
          <article className="observation-message is-user">
            <div className="observation-message__bubble">
              <div className="observation-message__body">
                <p>标本用户追问，不是真实会话。</p>
              </div>
            </div>
            <span className="observation-message__avatar">宏</span>
          </article>
          <article className="observation-message is-assistant">
            <div className="observation-message__bubble">
              <div className="observation-message__body">
                <p>标本助手回复，仅对照设计稿。</p>
              </div>
              <span className="observation-message__copy"><Icon name="copy" size={14} />复制</span>
            </div>
          </article>
        </div>
        <div className="observation-follow-up-sheet__suggest">
          <p>追问推荐：</p>
          <div className="chip-row">
            <span className="chip">标本推荐问句</span>
          </div>
        </div>
        <form className="observation-follow-up-composer">
          <span className="playbook-follow-up-sheet__input">继续针对本次记录追问...</span>
          <span className="observation-follow-up-composer__send"><Icon name="arrow_up" size={16} /></span>
        </form>
      </div>
    </div>
  );
}

const PLAYBOOK_OBSERVING_SESSION: DiagnosisSessionRecord = {
  sessionId: "playbook-observing",
  mode: "face",
  reportStatus: "running",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  image: {
    uri: OBSERVATION_FACE_SCAN_SRC,
    kind: "image",
    origin: "imported",
    displayName: "设计稿标本，不是用户图片",
  },
};

const PLAYBOOK_OBSERVING_PROGRESS: StructuredGenerationProgressV1 = {
  schemaVersion: "structured-generation-progress.v1",
  flow: "diagnosis-report",
  phase: "generating",
  thinking: {
    status: "streaming",
    text: "标本推理文案，仅用于对照设计稿，不是真实观察。",
  },
  modules: [
    {
      moduleId: "visual-observations",
      status: "succeeded",
      // 标本结果：演示模块完成后的页面层内容预览，不是真实观察结论。
      result: {
        imageQuality: { usable: true, overallQuality: "limited" },
        observations: [
          { region: "标本区域", description: "标本观察文案，仅用于对照设计稿，不是真实观察结论。" },
        ],
      },
    },
    { moduleId: "observation-summary", status: "running" },
    { moduleId: "wellness-recommendations", status: "pending" },
    { moduleId: "safety-limitations", status: "pending" },
    { moduleId: "follow-up-questions", status: "pending" },
  ],
};

export function PlaybookObservingSpecimen() {
  return (
    <div className="playbook-observing">
      <p className="playbook-kicker">设计稿标本 · 不是真实观察会话</p>
      <ObservationObservingScreen
        diagnosisAvailable
        onCancel={() => undefined}
        progress={PLAYBOOK_OBSERVING_PROGRESS}
        session={PLAYBOOK_OBSERVING_SESSION}
      />
    </div>
  );
}

export function PlaybookSettingsSpecimen() {
  const rows = [
    { icon: settingsRowGlyphs.profile, title: "我的资料", value: "名字、门店与经营标签" },
    { icon: settingsRowGlyphs.ai, title: "AI 服务", value: "已连接时显示模型名" },
    { icon: settingsRowGlyphs.alerts, title: "通知提醒", value: "本机开关" },
    { icon: settingsRowGlyphs.scheme, title: "深色模式", value: "跟随系统" },
    { icon: settingsRowGlyphs.theme, title: "主题色", value: "品牌绿" },
    { icon: settingsRowGlyphs.storage, title: "存储管理", value: "真实估算，不写死体积" },
    { icon: settingsRowGlyphs.about, title: "关于", value: "运行中版本号" },
    { icon: settingsRowGlyphs.privacy, title: "隐私说明", value: "" },
  ] as const;
  return (
    <div className="playbook-settings">
      {rows.map((row) => (
        <div className="playbook-settings__row" key={row.title}>
          <Icon name={row.icon} size={19} />
          <span>{row.title}</span>
          {row.value ? <small>{row.value}</small> : null}
          <Icon name="chevron_right" size={16} />
        </div>
      ))}
    </div>
  );
}

export function PlaybookRecentRecordActionsSpecimen() {
  return (
    <div className="playbook-record-actions">
      <p className="playbook-kicker">设计稿标本 · 长按最近记录打开，不是真实数据</p>
      <div className="playbook-record-actions__card">
        <span className="playbook-record-actions__icon"><Icon name="video_file" size={18} /></span>
        <span><strong>最近拆解 · 本地视频</strong><small>已完成 · 本机保存</small></span>
        <Icon name="chevron_right" size={16} />
      </div>
      <div className="playbook-record-actions__sheet">
        <span className="playbook-sheet__handle" />
        <h3>记录操作</h3>
        <p className="playbook-record-actions__label">拆解记录 · 本地视频</p>
        <div className="sheet-action-list">
          <div className="playbook-record-actions__delete">
            <span className="sheet-action__icon"><Icon name="trash_2" size={20} /></span>
            <span><strong>删除记录</strong><small>只移除这条记录的本机媒体与产物</small></span>
          </div>
        </div>
        <div className="playbook-record-actions__cancel">取消</div>
      </div>
      <p className="playbook-hint">进行中的拆解或观察保持锁定；确认删除前会再次说明本机媒体和数据文件边界。</p>
    </div>
  );
}
