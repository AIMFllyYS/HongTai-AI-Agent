import { requirementRoleLabel, type RequirementBinding } from "../features/replica/replica-blueprint-view";
import { Button } from "./Buttons";
import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

export interface ReplicaRequirementCardProps {
  readonly binding: RequirementBinding;
  readonly disabled: boolean;
  readonly onImport: () => void;
  readonly onRemove: () => void;
}

/**
 * One item of the material list: what to film, and the file that satisfies it.
 *
 * The bound file is shown by name because it is the only thing that tells the user whether they
 * attached the clip they meant to; the wizard cannot decode what the footage actually shows.
 */
export function ReplicaRequirementCard({ binding, disabled, onImport, onRemove }: ReplicaRequirementCardProps) {
  const { requirement, asset } = binding;
  const kind = requirement.materialKind === "video" ? "视频" : "图片";

  return (
    <GlassCard className={`replica-requirement${asset ? " replica-requirement--bound" : ""}`} tone="soft">
      <header className="replica-requirement__head">
        <em>{String(requirement.order).padStart(2, "0")}</em>
        <div>
          <strong>{requirement.contentHint}</strong>
          <small>
            {requirementRoleLabel(requirement.role)} · 建议 {kind} 约 {requirement.suggestedDurationSeconds} 秒
          </small>
        </div>
        {asset ? <Icon name="check_circle" size={20} /> : null}
      </header>

      <dl className="replica-requirement__brief">
        <dt>要拍什么</dt>
        <dd>{requirement.visualDescription}</dd>
        <dt>可以这样说</dt>
        <dd>{requirement.scriptDraft}</dd>
      </dl>

      {asset ? (
        <div className="replica-requirement__bound">
          <p>
            <Icon name="movie_edit" size={16} />
            {asset.displayName}
            {asset.durationSeconds === undefined ? "" : ` · ${asset.durationSeconds.toFixed(1)} 秒`}
          </p>
          <Button disabled={disabled} onClick={onRemove} variant="quiet">
            <Icon name="remove" size={16} />换一个
          </Button>
        </div>
      ) : (
        <Button disabled={disabled} onClick={onImport} variant="secondary">
          <Icon name="add" size={16} />选这一项的素材
        </Button>
      )}

      <p className="replica-requirement__note">
        这段草稿只是参考。最终口播会按你真正绑定的素材重写，字幕也按重写后的文案生成。
      </p>
    </GlassCard>
  );
}
