/**
 * 后台运行（TaskGuard）用户偏好的持久化。运行时侧只接收布尔值；
 * 持久化与默认值归属表现层，与 appearance-preferences 同一模式。
 * 默认开启：核心诉求即熄屏/切后台续跑；关闭时回到「亮屏保持」现状行为。
 */
export interface BackgroundRunPreferences {
  readonly enabled: boolean;
}

export const BACKGROUND_RUN_STORAGE_KEY = "hongtai.background-run.v1";

export const DEFAULT_BACKGROUND_RUN_PREFERENCES: BackgroundRunPreferences = {
  enabled: true,
};

export function parseBackgroundRunPreferences(raw: string | null): BackgroundRunPreferences {
  if (!raw) return DEFAULT_BACKGROUND_RUN_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<BackgroundRunPreferences>;
    return {
      enabled: parsed.enabled !== false,
    };
  } catch {
    return DEFAULT_BACKGROUND_RUN_PREFERENCES;
  }
}

export function readBackgroundRunPreferences(): BackgroundRunPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_BACKGROUND_RUN_PREFERENCES;
  return parseBackgroundRunPreferences(localStorage.getItem(BACKGROUND_RUN_STORAGE_KEY));
}

export function writeBackgroundRunPreferences(prefs: BackgroundRunPreferences): BackgroundRunPreferences {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(BACKGROUND_RUN_STORAGE_KEY, JSON.stringify(prefs));
  }
  return prefs;
}
