import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { appInfoSettingsPath, playbookPath, playbookSectionPath, type Navigate } from "../router";
import { playbookSectionById, playbookSections } from "./sections";

export interface PlaybookPageProps {
  readonly navigate: Navigate;
  readonly sectionId?: string;
}

const groups = ["规范", "组件", "主路径", "观察与账户"] as const;

export function PlaybookPage({ navigate, sectionId }: PlaybookPageProps) {
  const section = playbookSectionById(sectionId);
  if (sectionId && !section) {
    return (
      <AppShell activeNav="settings" backPath={playbookPath()} navigate={navigate} title="设计稿对照">
        <div className="page-stack page-playbook">
          <p className="playbook-note">没有这个板块。请从对照目录重新进入。</p>
        </div>
      </AppShell>
    );
  }

  if (section) {
    const Specimen = section.Render;
    return (
      <AppShell activeNav="settings" backPath={playbookPath()} navigate={navigate} subtitle={section.summary} title={section.title}>
        <div className="page-stack page-playbook">
          <p className="playbook-note">设计稿对照。这里的文案和样例不是真实任务或报告；产品页面引用同一套图标和板块。</p>
          <Specimen />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeNav="settings" backPath={appInfoSettingsPath()} navigate={navigate} subtitle="未归档 hongtai-mobile.pen 的页面层对照" title="设计稿对照">
      <div className="page-stack page-playbook">
        <p className="playbook-note">设计稿各板块先收在这里，产品页面再引用同一套图标和板块。不展示真实任务、密钥或诊察结果。</p>
        {groups.map((group) => (
          <section className="playbook-group" key={group}>
            <h2>{group}</h2>
            <div className="playbook-index">
              {playbookSections.filter((item) => item.group === group).map((item) => (
                <button className="playbook-index__card" key={item.id} onClick={() => navigate(playbookSectionPath(item.id))} type="button">
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.summary}</small>
                  </span>
                  <Icon name="chevron_right" size={16} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
