export type ColorSchemePreference = "system" | "light" | "dark";

export interface AppearancePreferences {
  readonly alertsEnabled: boolean;
  readonly colorScheme: ColorSchemePreference;
}

export const APPEARANCE_STORAGE_KEY = "hongtai.appearance.v1";

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  alertsEnabled: true,
  colorScheme: "system",
};

export function parseAppearancePreferences(raw: string | null): AppearancePreferences {
  if (!raw) return DEFAULT_APPEARANCE_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<AppearancePreferences>;
    const colorScheme = parsed.colorScheme === "light" || parsed.colorScheme === "dark" || parsed.colorScheme === "system"
      ? parsed.colorScheme
      : DEFAULT_APPEARANCE_PREFERENCES.colorScheme;
    return {
      alertsEnabled: parsed.alertsEnabled !== false,
      colorScheme,
    };
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function serializeAppearancePreferences(prefs: AppearancePreferences): string {
  return JSON.stringify(prefs);
}

export function colorSchemeLabel(scheme: ColorSchemePreference): string {
  if (scheme === "light") return "浅色";
  if (scheme === "dark") return "深色";
  return "跟随系统";
}

export function applyColorScheme(scheme: ColorSchemePreference): void {
  if (typeof document === "undefined") return;
  if (scheme === "system") {
    delete document.documentElement.dataset.colorScheme;
    return;
  }
  document.documentElement.dataset.colorScheme = scheme;
}

export function readAppearancePreferences(): AppearancePreferences {
  if (typeof localStorage === "undefined") return DEFAULT_APPEARANCE_PREFERENCES;
  return parseAppearancePreferences(localStorage.getItem(APPEARANCE_STORAGE_KEY));
}

export function writeAppearancePreferences(prefs: AppearancePreferences): AppearancePreferences {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, serializeAppearancePreferences(prefs));
  }
  applyColorScheme(prefs.colorScheme);
  return prefs;
}

export function applyStoredAppearancePreferences(): AppearancePreferences {
  const prefs = readAppearancePreferences();
  applyColorScheme(prefs.colorScheme);
  return prefs;
}
