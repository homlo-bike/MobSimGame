/**
 * Notification settings (per severity): show as a pop-up, keep in the notification list.
 * Errors are always kept. Browser settings, not project data (localStorage).
 */
import { create } from 'zustand';
import type { NotificationSeverity } from './notifications';

export type SettingLevel = 'info' | 'warning' | 'error';
export interface LevelSetting {
  popup: boolean;
  keep: boolean;
}
export type NotificationSettings = Record<SettingLevel, LevelSetting>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  info: { popup: true, keep: true },
  warning: { popup: true, keep: true },
  error: { popup: true, keep: true },
};

/** Success messages follow the info setting. */
export const levelOf = (s: NotificationSeverity): SettingLevel => (s === 'success' ? 'info' : s);

/** Pure: whether a notification of this severity pops up and is kept. */
export function applySettings(
  settings: NotificationSettings,
  severity: NotificationSeverity,
): { popup: boolean; keep: boolean } {
  const l = settings[levelOf(severity)];
  return { popup: l.popup, keep: severity === 'error' ? true : l.keep };
}

const KEY = 'mobsimgame.notificationSettings.v1';

function load(): NotificationSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const v = JSON.parse(raw) as Partial<NotificationSettings>;
    const out = { ...DEFAULT_NOTIFICATION_SETTINGS };
    for (const k of ['info', 'warning', 'error'] as const)
      if (v[k]) out[k] = { popup: !!v[k].popup, keep: k === 'error' ? true : !!v[k].keep };
    return out;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

interface SettingsState {
  settings: NotificationSettings;
  set: (level: SettingLevel, patch: Partial<LevelSetting>) => void;
  reset: () => void;
}

export const useNotificationSettings = create<SettingsState>()((set, get) => ({
  settings: load(),
  set: (level, patch) => {
    const next = {
      ...get().settings,
      [level]: { ...get().settings[level], ...patch, ...(level === 'error' ? { keep: true } : {}) },
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: the settings last for this page only */
    }
    set({ settings: next });
  },
  reset: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing stored */
    }
    set({ settings: DEFAULT_NOTIFICATION_SETTINGS });
  },
}));
