import { useEffect } from "react";
import type { AppRuntime } from "@hongtai/core";

import { AppShell } from "../components/AppShell";
import { PageSkeleton } from "../components/PageSkeleton";
import { useSkeletonHold } from "../motion/skeleton-hold";
import { pathForRoute, type Navigate } from "../router";

export interface ProductionEditPageProps {
  readonly projectId: string;
  readonly navigate: Navigate;
  readonly runtime: AppRuntime;
}

/**
 * 旧「微调」路由的兼容重定向（spec `rebuild-production-pipeline`）：
 * 逐镜编辑已并入制作阶段页的分镜卡，本路由只把历史链接带回制作页并定位到该项目。
 */
export function ProductionEditPage({ projectId, navigate, runtime }: ProductionEditPageProps) {
  const loading = true;
  const showSkeleton = useSkeletonHold(loading);

  useEffect(() => {
    // 项目存在与否都回制作页：不存在的项目由制作页如实呈现空列表，这里不留死状态。
    void runtime.production.get(projectId).catch(() => undefined).finally(() => {
      navigate(`${pathForRoute("create")}?project=${encodeURIComponent(projectId)}`);
    });
  }, [navigate, projectId, runtime]);

  return (
    <AppShell activeNav="create" navigate={navigate} showNav={false} title="制作">
      {showSkeleton ? <PageSkeleton layout="create" /> : <p className="production-edit-redirect-note">正在返回制作页…</p>}
    </AppShell>
  );
}
