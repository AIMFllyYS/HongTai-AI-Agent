import { Icon, type IconName } from "./Icon";

interface StatePanelProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: IconName;
  readonly action?: React.ReactNode;
  readonly className?: string;
}

export function EmptyState({ title, description, icon = "folder_open", action, className = "" }: StatePanelProps) {
  return <div className={`state-panel state-panel--empty ${className}`.trim()}><Icon name={icon} size={32} /><strong>{title}</strong>{description ? <p>{description}</p> : null}{action}</div>;
}

export function LoadingState({ title, description, icon = "sync", className = "" }: StatePanelProps) {
  return <div className={`state-panel state-panel--loading ${className}`.trim()}><span className="state-panel__spinner"><Icon name={icon} size={28} /></span><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>;
}

export function ErrorState({ title, description, icon = "error", action, className = "" }: StatePanelProps) {
  return <div className={`state-panel state-panel--error ${className}`.trim()}><Icon name={icon} size={32} /><strong>{title}</strong>{description ? <p>{description}</p> : null}{action}</div>;
}
