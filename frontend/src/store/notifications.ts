/**
 * In-session notification centre.
 *
 * Every toast is also recorded here (unless marked transient-only). Identical
 * notifications (same severity, title, message and related object) are grouped:
 * the existing entry gets a higher count, a new timestamp and becomes unread
 * again, so retries and repeated errors never flood the list.
 *
 * Notifications are UI state, not project data: they are kept for the browser
 * session only (sessionStorage) and never written into the project document.
 */
import { create } from 'zustand';
import type { LngLat } from '../domain/schema';
import { newId } from '../util/id';
import { applySettings, useNotificationSettings } from './notificationSettings';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export type NotificationKind =
  'file' | 'share' | 'routing' | 'network' | 'validation' | 'connection' | 'update' | 'project' | 'general';

/** What a notification is about; selecting it focuses and selects that object. */
export interface NotificationTarget {
  projectId?: string;
  lineId?: string;
  stationId?: string;
  segmentId?: string;
  position?: LngLat;
}

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  kind: NotificationKind;
  title: string;
  message: string;
  target: NotificationTarget | null;
  createdAt: string;
  updatedAt: string;
  /** How many times this notification occurred (grouped duplicates). */
  count: number;
  read: boolean;
}

export interface NotifyInput {
  severity: NotificationSeverity;
  kind?: NotificationKind;
  title: string;
  message?: string;
  target?: NotificationTarget | null;
  /** Show as a toast (default true). */
  toast?: boolean;
  /** Record in the notification centre (default true). */
  record?: boolean;
}

export const MAX_NOTIFICATIONS = 200;

const targetKey = (t: NotificationTarget | null | undefined) =>
  t ? [t.projectId, t.lineId, t.stationId, t.segmentId].map((x) => x ?? '').join('|') : '';

export function dedupeKey(
  n: Pick<AppNotification, 'severity' | 'kind' | 'title' | 'message' | 'target'>,
): string {
  return [n.severity, n.kind, n.title, n.message, targetKey(n.target)].join('§');
}

/** Pure: add a notification, grouping it with an identical existing one. */
export function addNotification(
  list: readonly AppNotification[],
  input: NotifyInput,
  now: string,
  id: string = newId('ntf'),
): { list: AppNotification[]; notification: AppNotification } {
  const candidate: AppNotification = {
    id,
    severity: input.severity,
    kind: input.kind ?? 'general',
    title: input.title,
    message: input.message ?? '',
    target: input.target ?? null,
    createdAt: now,
    updatedAt: now,
    count: 1,
    read: false,
  };
  const key = dedupeKey(candidate);
  const existing = list.find((n) => dedupeKey(n) === key);
  if (existing) {
    const updated = { ...existing, count: existing.count + 1, updatedAt: now, read: false };
    // Move the grouped entry to the top: it is the most recent occurrence.
    return { list: [updated, ...list.filter((n) => n.id !== existing.id)], notification: updated };
  }
  return { list: [candidate, ...list].slice(0, MAX_NOTIFICATIONS), notification: candidate };
}

const STORAGE_KEY = 'mobsimgame.notifications.v1';

function load(): AppNotification[] {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function persist(list: AppNotification[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* session storage unavailable: the list lives in memory only */
  }
}

interface NotificationState {
  items: AppNotification[];
  /** The notification currently shown as a toast. */
  toast: AppNotification | null;
  notify: (input: NotifyInput) => AppNotification;
  dismissToast: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

export const useNotifications = create<NotificationState>()((set, get) => ({
  items: load(),
  toast: null,
  notify: (raw) => {
    const now = new Date().toISOString();
    // The user's notification settings decide pop-up and keeping (errors are always kept).
    const pref = applySettings(useNotificationSettings.getState().settings, raw.severity);
    const input = {
      ...raw,
      toast: raw.toast !== false && pref.popup,
      record: raw.record !== false && pref.keep,
    };
    if (input.record === false) {
      const n = addNotification([], input, now).notification;
      if (input.toast !== false) set({ toast: n });
      return n;
    }
    const { list, notification } = addNotification(get().items, input, now);
    persist(list);
    set({ items: list, ...(input.toast !== false ? { toast: notification } : {}) });
    return notification;
  },
  dismissToast: () => set({ toast: null }),
  markRead: (id) => {
    const items = get().items.map((n) => (n.id === id ? { ...n, read: true } : n));
    persist(items);
    set({ items });
  },
  markAllRead: () => {
    const items = get().items.map((n) => ({ ...n, read: true }));
    persist(items);
    set({ items });
  },
  dismiss: (id) => {
    const items = get().items.filter((n) => n.id !== id);
    persist(items);
    set({ items, toast: get().toast?.id === id ? null : get().toast });
  },
  clearAll: () => {
    persist([]);
    set({ items: [], toast: null });
  },
}));

/** Convenience for non-React code. */
export const notify = (input: NotifyInput) => useNotifications.getState().notify(input);
