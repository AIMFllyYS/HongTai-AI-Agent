import { MIN_MONTAGE_VISUAL_ASSETS } from "@hongtai/core";

import { GlassCard } from "./GlassCard";
import { Icon } from "./Icon";

export type ProductionEntryKind = "agent" | "replica";

export interface ProductionModeEntryProps {
  readonly onSelect: (kind: ProductionEntryKind) => void;
}

/**
 * First screen of the create tab: two product paths, not three. Avatar stays inside Agent.
 * Copy is the weaker true sentence — insight is sampled frames, not a match check.
 */
export function ProductionModeEntry({ onSelect }: ProductionModeEntryProps) {
  return (
    <div aria-label="制作入口" className="production-entry-grid" role="group">
      <GlassCard className="production-entry-card" data-production-entry="agent" onClick={() => onSelect("agent")}>
        <div className="production-entry-card__head">
          <Icon name="movie_edit" size={22} />
          <strong>智能成片</strong>
          <Icon name="chevron_right" size={19} />
        </div>
        <p>用一句话说明这次想讲什么，直接开始。应用会写旁白和字幕；成片要导入素材后，在制作页再发起合成。</p>
        <p className="production-entry-card__caveat">这台安装不一定能看画面：看不到就按你的需求写，能看到才会参考画面里看得见的内容。无论哪种情况都不会核对文字是否对得上每个镜头，需要你逐镜核对。</p>
        <small>一句话需求就能开始；准备至少 {MIN_MONTAGE_VISUAL_ASSETS} 张图片或视频再合成。配音优先用 AI 连接里的云端旁白，没配才用系统语音。</small>
        <small>数字人出镜是下一步里的开关：一段数字人预处理视频即可，配音、字幕与画面裁剪拼接全部自动完成，不需要 {MIN_MONTAGE_VISUAL_ASSETS} 份素材。</small>
      </GlassCard>
      <GlassCard className="production-entry-card" data-production-entry="replica" onClick={() => onSelect("replica")}>
        <div className="production-entry-card__head">
          <Icon name="list" size={22} />
          <strong>爆款复刻</strong>
          <Icon name="chevron_right" size={19} />
        </div>
        <p>按拆解列出的分镜清单，逐项拍摄或绑定素材，再生成脚本和字幕。</p>
        <p className="production-entry-card__caveat">清单只说该拍什么，不代表画面里真的有这些内容；绑错文件也不会被拦住。</p>
        <small>需要一份成功拆解。还没有的话，先去采集并运行 AI 拆解。成片仍要回制作页合成。</small>
      </GlassCard>
    </div>
  );
}
