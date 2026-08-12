import type { RuntimeUnfinishedWork } from "@hongtai/core";

export interface AppStateChange {
  readonly isActive: boolean;
}

export interface AppStateListenerHandle {
  remove(): Promise<void>;
}

export interface AppLifecycleCoordinatorOptions {
  readonly subscribe: (
    listener: (state: AppStateChange) => void,
  ) => Promise<AppStateListenerHandle>;
  readonly inspectUnfinishedWork: () => Promise<readonly RuntimeUnfinishedWork[]>;
  readonly reload: () => void;
  readonly notifyResume: () => void;
}

export interface InstalledAppLifecycleCoordinator {
  remove(): Promise<void>;
  whenIdle(): Promise<void>;
}

/**
 * Reconciles a real inactive-to-active edge. A WebView-owned promise cannot be
 * trusted after background suspension, while external Android Activities must
 * be allowed to deliver their result back into the existing bridge call.
 */
export async function installAppLifecycleCoordinator(
  options: AppLifecycleCoordinatorOptions,
): Promise<InstalledAppLifecycleCoordinator> {
  let previousIsActive: boolean | undefined;
  let reloading = false;
  let pending = Promise.resolve();

  const reconcile = async (): Promise<void> => {
    if (reloading) return;
    try {
      const unfinished = await options.inspectUnfinishedWork();
      if (unfinished.some((work) => work.execution === "in-process")) {
        reloading = true;
        options.reload();
        return;
      }
      options.notifyResume();
    } catch {
      reloading = true;
      options.reload();
    }
  };

  const handle = await options.subscribe((state) => {
    const resumed = previousIsActive === false && state.isActive;
    previousIsActive = state.isActive;
    if (!resumed || reloading) return;
    pending = pending.then(reconcile);
  });

  return {
    remove: () => handle.remove(),
    whenIdle: () => pending,
  };
}
