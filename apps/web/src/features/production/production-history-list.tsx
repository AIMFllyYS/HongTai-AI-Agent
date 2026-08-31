import { useState } from "react";

import type { ProductionProjectRecord } from "@hongtai/core";

import { Icon } from "../../components/Icon";
import { productionStatusLabel } from "./production-workbench-model";

/** 历史列表默认只露最近几条，其余收进「展开全部」，弱化旧记录在首屏的存在感。 */
const HISTORY_VISIBLE_COUNT = 3;

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
  const [expanded, setExpanded] = useState(false);
  if (projects.length === 0) return null;
  const visible = expanded ? projects : projects.slice(0, HISTORY_VISIBLE_COUNT);
  return (
    <section className="production-history">
      <h3>本地制作记录</h3>
      <div>
        {visible.map((item) => (
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
      {!expanded && projects.length > HISTORY_VISIBLE_COUNT ? (
        <button className="production-history__more" onClick={() => setExpanded(true)} type="button">
          <Icon name="chevron_down" size={16} />展开全部（{projects.length} 条）
        </button>
      ) : null}
    </section>
  );
}
