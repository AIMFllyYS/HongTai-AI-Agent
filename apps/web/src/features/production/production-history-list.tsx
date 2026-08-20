import type { ProductionProjectRecord } from "@hongtai/core";

import { productionStatusLabel } from "../../pages/production-workbench-model";

export interface ProductionHistoryListProps {
  readonly projects: readonly ProductionProjectRecord[];
  readonly activeProjectId?: string;
  readonly composingNew: boolean;
  readonly onSelect: (project: ProductionProjectRecord) => void;
}

export function ProductionHistoryList({
  projects,
  activeProjectId,
  composingNew,
  onSelect,
}: ProductionHistoryListProps) {
  if (projects.length === 0) return null;
  return (
    <section className="production-history">
      <h3>本地制作记录</h3>
      <div>
        {projects.map((item) => (
          <button
            className={!composingNew && item.projectId === activeProjectId ? "is-active" : ""}
            key={item.projectId}
            onClick={() => onSelect(item)}
            type="button"
          >
            <span>{item.brief}</span>
            <small>{productionStatusLabel(item.status)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
