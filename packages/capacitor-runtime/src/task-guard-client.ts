import type {
  BackgroundRunNotificationPermission,
  BackgroundRunStatusV1,
  RuntimeWorkKind,
} from "@hongtai/core";

import type {
  StandaloneForegroundServicePlugin,
  StandaloneTaskGuardPlugin,
} from "./standalone-bridge.js";

/** Long-task kinds the guard covers; `transient-operation` never holds it. */
export const TASK_GUARD_KINDS: readonly RuntimeWorkKind[] = [
  "ingest",
  "content-analysis",
  "diagnosis-report",
  "production-plan",
  "production-render",
];

/** Structural port so the operation registry stays decoupled from the client. */
export interface TaskGuardPort {
  withTaskGuard<T>(kind: RuntimeWorkKind, run: () => Promise<T>): Promise<T>;
}

export interface TaskGuardClientOptions {
  readonly taskGuard?: StandaloneTaskGuardPlugin;
  readonly foregroundService?: StandaloneForegroundServicePlugin;
  /** User preference copy; the presentation layer owns persistence. Defaults to enabled. */
  readonly enabled?: boolean;
}

const NOTIFICATION_ID = 1;
const NOTIFICATION_CHANNEL_ID = "task-guard";
const NOTIFICATION_TITLE = "后台运行中";
const NOTIFICATION_BODY = "任务正在后台继续执行，点击返回应用查看";
const NOTIFICATION_SMALL_ICON = "ic_stat_task_guard";

function permissionState(display: unknown): BackgroundRunNotificationPermission {
  return display === "granted" || display === "denied" || display === "prompt" ? display : "unknown";
}

/**
 * Process-local reference-counted guard for long tasks: the first hold starts a
 * specialUse foreground service (notification) and acquires the partial wake
 * lock; the last release stops both. Every platform call is best-effort — a
 * guard failure must never fail the guarded task itself, it only degrades
 * background survivability. Business decisions about *when* to guard stay in
 * the shared services; this client is mechanism only.
 */
export class TaskGuardClient implements TaskGuardPort {
  readonly #taskGuard?: StandaloneTaskGuardPlugin;
  readonly #foregroundService?: StandaloneForegroundServicePlugin;
  readonly #holds = new Map<RuntimeWorkKind, number>();
  #enabled: boolean;
  #channelCreated = false;

  constructor(options: TaskGuardClientOptions) {
    this.#taskGuard = options.taskGuard;
    this.#foregroundService = options.foregroundService;
    this.#enabled = options.enabled ?? true;
  }

  #supported(): boolean {
    return Boolean(this.#taskGuard && this.#foregroundService);
  }

  #totalHolds(): number {
    let total = 0;
    for (const count of this.#holds.values()) total += count;
    return total;
  }

  async #startGuard(): Promise<void> {
    const taskGuard = this.#taskGuard;
    const foregroundService = this.#foregroundService;
    if (!taskGuard || !foregroundService) return;
    const setup = this.#channelCreated
      ? Promise.resolve()
      : foregroundService
        .createNotificationChannel({
          id: NOTIFICATION_CHANNEL_ID,
          name: "后台任务",
          description: "长任务在后台继续运行的状态通知",
          // 2 = Low in the plugin's Importance enum: status-bar only, no sound.
          importance: 2,
        })
        .then(() => {
          this.#channelCreated = true;
        });
    await Promise.allSettled([
      setup.then(() => foregroundService.startForegroundService({
        id: NOTIFICATION_ID,
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
        smallIcon: NOTIFICATION_SMALL_ICON,
        notificationChannelId: NOTIFICATION_CHANNEL_ID,
        // Matches the plugin's `Importance` enum; 2 = Low (silent status bar post).
        importance: 2,
      })),
      taskGuard.holdWakeLock({ kind: "task-guard" }),
    ]);
  }

  async #stopGuard(): Promise<void> {
    const taskGuard = this.#taskGuard;
    const foregroundService = this.#foregroundService;
    if (!taskGuard || !foregroundService) return;
    await Promise.allSettled([
      foregroundService.stopForegroundService(),
      taskGuard.releaseWakeLock({ kind: "task-guard" }),
    ]);
  }

  async withTaskGuard<T>(kind: RuntimeWorkKind, run: () => Promise<T>): Promise<T> {
    if (!this.#supported() || !this.#enabled) return run();
    const previous = this.#holds.get(kind) ?? 0;
    this.#holds.set(kind, previous + 1);
    if (previous === 0 && this.#totalHolds() === 1) await this.#startGuard();
    try {
      return await run();
    } finally {
      const current = (this.#holds.get(kind) ?? 1) - 1;
      if (current <= 0) this.#holds.delete(kind);
      else this.#holds.set(kind, current);
      if (this.#totalHolds() === 0) await this.#stopGuard();
    }
  }

  async getStatus(): Promise<BackgroundRunStatusV1> {
    if (!this.#supported() || !this.#taskGuard || !this.#foregroundService) {
      return {
        schemaVersion: "background-run-status.v1",
        enabled: this.#enabled,
        supported: false,
        batteryOptimizationIgnored: false,
        notificationPermission: "unknown",
        activeGuards: 0,
      };
    }
    const [native, permissions] = await Promise.all([
      this.#taskGuard.getBackgroundRunStatus(),
      this.#foregroundService.checkPermissions().catch(() => undefined),
    ]);
    return {
      schemaVersion: "background-run-status.v1",
      enabled: this.#enabled,
      supported: true,
      batteryOptimizationIgnored: native.batteryOptimizationIgnored === true,
      notificationPermission: permissionState(permissions?.display),
      activeGuards: this.#totalHolds(),
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled;
    if (!this.#taskGuard) return;
    // Mirror the preference so the native screen-stay policy can branch on it
    // (background run on ⇒ allow the screen to turn off).
    await this.#taskGuard.setBackgroundRunEnabled({ enabled }).catch(() => undefined);
  }

  async requestIgnoreBatteryOptimizations(): Promise<{ readonly opened: "request" | "optimization-list" | "app-details" }> {
    if (!this.#taskGuard) throw new Error("当前环境不支持电池优化设置引导");
    const result = await this.#taskGuard.requestIgnoreBatteryOptimizations();
    const opened = result.opened;
    if (opened !== "request" && opened !== "optimization-list" && opened !== "app-details") {
      throw new Error("未能打开电池优化设置");
    }
    return { opened };
  }

  async requestNotificationPermission(): Promise<BackgroundRunNotificationPermission> {
    if (!this.#foregroundService) return "unknown";
    const permissions = await this.#foregroundService.requestPermissions();
    return permissionState(permissions.display);
  }
}
