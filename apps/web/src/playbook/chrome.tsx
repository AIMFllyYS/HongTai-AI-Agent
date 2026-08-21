import { Button } from "../components/Buttons";
import { Icon } from "../components/Icon";
import { Switch } from "../components/Switch";
import { Tabs } from "../components/Tabs";
import { na5IconCells, screenIconCells } from "./icon-catalog";

const colorSwatches = [
  { token: "--surface-canvas", label: "页面底色", note: "白为主，占画面 90% 以上" },
  { token: "--palette-brand", label: "品牌绿", note: "小按钮、加号、激活态" },
  { token: "--palette-brand-deep", label: "按下绿", note: "浅绿底上的文字、按下态" },
  { token: "--palette-brand-tint", label: "淡绿底", note: "头像底、小图标底" },
  { token: "--palette-ink-900", label: "标题墨", note: "标题与正文" },
  { token: "--palette-ink-600", label: "次要墨", note: "说明、次要信息" },
  { token: "--palette-ink-400", label: "占位墨", note: "占位、时间、脚注" },
  { token: "--palette-fill", label: "浅底", note: "输入框、次按钮" },
  { token: "--palette-hairline", label: "分隔线", note: "列表分隔" },
  { token: "--palette-ok", label: "完成", note: "状态小点" },
  { token: "--palette-warn", label: "提醒", note: "状态小点" },
  { token: "--palette-err", label: "失败", note: "状态小点" },
] as const;

const typeRows = [
  { name: "大标题", size: "24px · 半粗", sample: "拆解", className: "playbook-type__display" },
  { name: "页面标题", size: "16px · 半粗", sample: "拆解详情", className: "playbook-type__headline" },
  { name: "区块标题", size: "15px · 半粗", sample: "最近拆解", className: "playbook-type__section" },
  { name: "正文", size: "14px · 常规", sample: "粘贴作品链接", className: "playbook-type__body" },
  { name: "次要信息", size: "12px · 常规", sample: "抖音 · 昨天 21:18", className: "playbook-type__caption" },
  { name: "脚注", size: "11px · 常规", sample: "结果仅供日常参考", className: "playbook-type__meta" },
  { name: "底栏标签", size: "10px · 常规", sample: "观察", className: "playbook-type__nav" },
] as const;

export function PlaybookColorScale() {
  return (
    <div className="playbook-swatch-grid">
      {colorSwatches.map((swatch) => (
        <article className="playbook-swatch" key={swatch.token}>
          <span className="playbook-swatch__chip" style={{ background: `var(${swatch.token})` }} />
          <strong>{swatch.label}</strong>
          <small>{swatch.note}</small>
        </article>
      ))}
    </div>
  );
}

export function PlaybookTypeScale() {
  return (
    <div className="playbook-type">
      <p className="playbook-kicker">中文 Noto Sans SC · 数字 Inter · 不使用粗体堆叠</p>
      {typeRows.map((row) => (
        <div className="playbook-type__row" key={row.name}>
          <span className={row.className}>{row.sample}</span>
          <small>{row.name} · {row.size}</small>
        </div>
      ))}
    </div>
  );
}

export function PlaybookIconGrid() {
  return (
    <div className="playbook-icon-board">
      <p className="playbook-kicker">图标 · Lucide · 描边风格 · 22px</p>
      <div className="playbook-icon-grid">
        {na5IconCells.map((cell) => (
          <div className="playbook-icon-cell" key={cell.name}>
            <Icon name={cell.name} size={22} />
            <span>{cell.label}</span>
          </div>
        ))}
      </div>
      <p className="playbook-kicker">屏幕补充图标</p>
      <div className="playbook-icon-grid">
        {screenIconCells.map((cell) => (
          <div className="playbook-icon-cell" key={cell.name}>
            <Icon name={cell.name} size={22} />
            <span>{cell.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlaybookChromePrimitives() {
  return (
    <div className="playbook-chrome">
      <div className="playbook-chrome__row">
        <Button>主要动作</Button>
        <Button variant="secondary">次要动作</Button>
      </div>
      <div className="playbook-chrome__row">
        <Button variant="ghost">线框动作</Button>
        <Button variant="quiet">弱动作</Button>
      </div>
      <Tabs active="选项一" ariaLabel="分段示例" id="playbook-segmented" tabs={["选项一", "选项二"]} variant="segmented" />
      <label className="playbook-input">
        <Icon name="link" size={17} />
        <span>输入内容</span>
      </label>
      <div className="playbook-chrome__row playbook-chrome__row--status">
        <span className="playbook-status"><span className="playbook-status__dot is-ok" />已完成</span>
        <Switch checked labelledBy="playbook-switch-on" onChange={() => undefined} />
        <Switch checked={false} labelledBy="playbook-switch-off" onChange={() => undefined} />
      </div>
      <div className="playbook-chrome__row">
        <span className="playbook-avatar">林</span>
        <span className="playbook-fab" aria-hidden="true"><Icon name="plus" size={18} /></span>
      </div>
    </div>
  );
}
