import type { SettingsRow, SettingsViewModel } from "../data/visual-types";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { PageHeading, SectionHeading, iconName } from "../components/PageBlocks";
import { MediaFrame } from "../components/MediaFrame";

export interface SettingsPageProps {
  readonly viewModel: SettingsViewModel;
  readonly navigate: (path: string) => void;
}

function SettingsRowView({ row }: { readonly row: SettingsRow }) {
  return <button className={`settings-row ${row.disabled ? "is-disabled" : ""}`.trim()} disabled={row.disabled} type="button"><span className="settings-row__icon"><Icon name={iconName(row.icon)} size={19} /></span><span className="settings-row__label">{row.label}</span>{row.value ? <span className="settings-row__value">{row.value}</span> : null}{row.action === "disclosure" || row.action === "select" ? <Icon className="settings-row__chevron" name="chevron_right" size={17} /> : null}</button>;
}

export function SettingsPage({ viewModel, navigate }: SettingsPageProps) {
  return (
    <AppShell activeNav="settings" navigate={navigate} title={viewModel.title}>
      <div className="page-stack page-settings">
        <PageHeading description="管理账户、AI 模型与通用偏好" title={viewModel.title} />
        <GlassCard className="profile-card">
          <MediaFrame className="profile-card__avatar" media={viewModel.avatar} />
          <div><h2>{viewModel.profileName}</h2><p>{viewModel.accountType}</p><span className="plan-badge">{viewModel.plan}</span></div>
          <Icon className="profile-card__chevron" name="chevron_right" size={19} />
        </GlassCard>

        <section className="settings-section"><SectionHeading title={viewModel.aiConfigTitle} /><GlassCard className="settings-card"><SettingsRowView row={viewModel.voiceRow} /></GlassCard></section>
        <section className="settings-section"><SectionHeading title={viewModel.modelTitle} /><GlassCard className="settings-card">{viewModel.modelRows.map((row) => <SettingsRowView key={row.id} row={row} />)}</GlassCard></section>
        <section className="settings-section"><SectionHeading title={viewModel.generalTitle} /><GlassCard className="settings-card">{viewModel.generalRows.map((row) => <SettingsRowView key={row.id} row={row} />)}</GlassCard></section>

        <Button className="logout-button" onClick={() => navigate("/")} variant="ghost"><Icon name="logout" size={18} />{viewModel.logoutLabel}</Button>
        <p className="copyright">{viewModel.copyright}</p>
      </div>
    </AppShell>
  );
}
