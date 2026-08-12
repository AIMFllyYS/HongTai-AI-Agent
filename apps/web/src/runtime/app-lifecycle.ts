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
  readonly notifyResume: () => void;
}

export interface InstalledAppLifecycleCoordinator {
  remove(): Promise<void>;
  whenIdle(): Promise<void>;
}

/**
 * Announces a real inactive-to-active edge without replacing the live WebView.
 * Process-rebuild recovery belongs to cold bootstrap; external Android
 * Activities must be allowed to deliver results into the existing bridge call.
 */
export async function installAppLifecycleCoordinator(
  options: AppLifecycleCoordinatorOptions,
): Promise<InstalledAppLifecycleCoordinator> {
  let previousIsActive: boolean | undefined;
  let pending = Promise.resolve();

  const notifyResume = async (): Promise<void> => {
    options.notifyResume();
  };

  const handle = await options.subscribe((state) => {
    const resumed = previousIsActive === false && state.isActive;
    previousIsActive = state.isActive;
    if (!resumed) return;
    pending = pending.then(notifyResume);
  });

  return {
    remove: () => handle.remove(),
    whenIdle: () => pending,
  };
}
