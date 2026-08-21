import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { issueFromAppError } from "@hongtai/core";
import type { AppRuntime, LocalProfile, TaskIssue } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { Button } from "../components/Buttons";
import { GlassCard } from "../components/GlassCard";
import { Icon } from "../components/Icon";
import { IssueNotice } from "../components/IssueNotice";
import { PageSkeleton } from "../components/PageSkeleton";
import { pathForRoute } from "../router";

export interface ProfileSettingsPageProps {
  readonly runtime: AppRuntime;
  readonly navigate: (path: string) => void;
}

interface ProfileDraft {
  readonly displayName: string;
  readonly avatarUri: string | null;
  readonly businessName: string;
  readonly industry: string;
  readonly businessTags: string;
}

const emptyDraft: ProfileDraft = {
  displayName: "",
  avatarUri: null,
  businessName: "",
  industry: "",
  businessTags: "",
};

function draftFromProfile(profile: LocalProfile | undefined): ProfileDraft {
  if (!profile) return emptyDraft;
  return {
    displayName: profile.displayName,
    avatarUri: profile.avatarUri,
    businessName: profile.businessName ?? "",
    industry: profile.industry ?? "",
    businessTags: profile.businessTags.join("，"),
  };
}

function parseTags(value: string): readonly string[] {
  return [...new Set(value.split(/[，,\n]/u).map((tag) => tag.trim()).filter(Boolean))];
}

function AvatarPreview({ draft }: { readonly draft: ProfileDraft }) {
  if (draft.avatarUri) return <img alt="当前头像" className="runtime-avatar runtime-avatar--large" src={draft.avatarUri} />;
  return <span aria-hidden="true" className="runtime-avatar runtime-avatar--empty runtime-avatar--large"><Icon name="face" size={34} /></span>;
}

export function ProfileSettingsPage({ runtime, navigate }: ProfileSettingsPageProps) {
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [issue, setIssue] = useState<TaskIssue>();
  const [savedAt, setSavedAt] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setIssue(undefined);
    try {
      setDraft(draftFromProfile(await runtime.profile.get()));
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "APP_RUNTIME_UNAVAILABLE", message: "本地档案暂时无法读取", action: "none" }));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseAvatar = async () => {
    setPicking(true);
    setIssue(undefined);
    try {
      const image = await runtime.profile.pickAvatar();
      setDraft((current) => ({ ...current, avatarUri: image.uri }));
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "MEDIA_IMPORT_FAILED", message: "头像导入失败", action: "select_media" }));
    } finally {
      setPicking(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setIssue(undefined);
    try {
      const profile = await runtime.profile.update({
        displayName: draft.displayName,
        avatarUri: draft.avatarUri,
        businessName: draft.businessName,
        industry: draft.industry,
        businessTags: parseTags(draft.businessTags),
      });
      setDraft(draftFromProfile(profile));
      setSavedAt(profile.updatedAt);
    } catch (error) {
      setIssue(issueFromAppError(error, { code: "PROFILE_SAVE_FAILED", message: "本地档案保存失败", action: "none" }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="我的资料"><PageSkeleton layout="settings" /></AppShell>;
  }

  return (
    <AppShell activeNav="settings" backPath="/settings" navigate={navigate} title="我的资料">
      <form className="page-stack page-settings settings-form" onSubmit={save}>
        {issue ? <IssueNotice actions={{ selectMedia: () => void chooseAvatar() }} issue={issue} /> : null}

        <GlassCard className="avatar-editor">
          <AvatarPreview draft={draft} />
          <div>
            <span className="settings-overline">头像仅保存在应用私有目录</span>
            <strong>{draft.avatarUri ? "已选择本地头像" : "尚未设置头像"}</strong>
            <small>通过系统照片选择器导入，页面不直接读取外部文件路径。</small>
          </div>
          <div className="avatar-editor__actions mobile-action-group">
            <Button disabled={picking} onClick={() => void chooseAvatar()} variant="secondary"><Icon name="camera" size={17} />{picking ? "导入中" : "更换头像"}</Button>
            {draft.avatarUri ? <Button disabled={picking} onClick={() => setDraft((current) => ({ ...current, avatarUri: null }))} variant="quiet">移除</Button> : null}
          </div>
        </GlassCard>

        <GlassCard className="settings-form__card">
          <label className="settings-field" htmlFor="profile-display-name"><span>名字 <em>必填</em></span><input autoComplete="nickname" id="profile-display-name" maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} required value={draft.displayName} /></label>
          <label className="settings-field" htmlFor="profile-business-name"><span>门店</span><input autoComplete="organization" id="profile-business-name" maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, businessName: event.target.value }))} value={draft.businessName} /></label>
          <label className="settings-field" htmlFor="profile-industry"><span>行业</span><input id="profile-industry" maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, industry: event.target.value }))} value={draft.industry} /></label>
          <label className="settings-field" htmlFor="profile-tags"><span>经营标签</span><textarea id="profile-tags" maxLength={300} onChange={(event) => setDraft((current) => ({ ...current, businessTags: event.target.value }))} placeholder="例如：咖啡，烘焙，社区店" rows={3} value={draft.businessTags} /><small>标签用逗号分隔，空标签不会保存</small></label>
        </GlassCard>

        {savedAt ? <p className="settings-save-note"><Icon name="check_circle" size={16} />已保存到本机：{new Date(savedAt).toLocaleString()}</p> : null}
        <Button disabled={saving} size="lg" type="submit"><Icon name="check_circle" size={18} />{saving ? "正在保存" : "保存资料"}</Button>
        <Button onClick={() => navigate(pathForRoute("settings"))} variant="quiet">返回设置</Button>
      </form>
    </AppShell>
  );
}
