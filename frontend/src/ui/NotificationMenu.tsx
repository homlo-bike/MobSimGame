/**
 * Notification centre: every recorded toast with severity, time, grouped count
 * and the object it relates to. Selecting a notification with a target selects
 * that line, station or segment and moves the map to it.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useNotifications, type AppNotification, type NotificationSeverity } from '../store/notifications';
import { useStore } from '../store/projectStore';
import { activeScenario } from '../domain/network';
import { focusTarget } from '../map/focus';
import { SEVERITY_LABEL, SEVERITY_SYMBOL } from './Toast';

type Filter = 'all' | NotificationSeverity;

/** A target the map can show (a project alone is not one). */
const onMap = (n: AppNotification) =>
  !!n.target && !!(n.target.lineId || n.target.stationId || n.target.segmentId || n.target.position);

export function NotificationMenu() {
  const items = useNotifications((s) => s.items);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const dismiss = useNotifications((s) => s.dismiss);
  const clearAll = useNotifications((s) => s.clearAll);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const unread = items.filter((n) => !n.read).length;
  const shown = filter === 'all' ? items : items.filter((n) => n.severity === filter);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (n: AppNotification) => {
    markRead(n.id);
    if (!onMap(n)) return;
    const state = useStore.getState();
    const ok = focusTarget(activeScenario(state.project), n.target!, state.select, state.setView);
    if (!ok) state.announce('The related object no longer exists in this project');
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded text-base text-slate-700 hover:bg-slate-100"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-red-700 px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id={panelId}
          aria-label="Notifications"
          className="absolute end-0 top-9 z-50 w-96 rounded-md border border-slate-300 bg-white shadow-xl"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 p-2">
            <label className="text-xs">
              <span className="sr-only">Filter by severity</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                className="rounded border border-slate-400 px-1 py-0.5 text-xs"
              >
                <option value="all">All ({items.length})</option>
                {(['error', 'warning', 'info', 'success'] as const).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]} ({items.filter((n) => n.severity === s).length})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ms-auto text-xs underline"
              onClick={markAllRead}
              disabled={!unread}
            >
              Mark all read
            </button>
            <button type="button" className="text-xs underline" onClick={clearAll} disabled={!items.length}>
              Clear all
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="p-3 text-sm text-slate-600">No notifications in this session.</p>
          ) : (
            <ul className="max-h-96 overflow-auto" aria-label="Notification list">
              {shown.map((n) => (
                <li
                  key={n.id}
                  className={`flex gap-2 border-b border-slate-100 p-2 text-sm ${n.read ? '' : 'bg-sky-50'}`}
                >
                  <span aria-hidden className="pt-0.5">
                    {SEVERITY_SYMBOL[n.severity]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block w-full text-start"
                      onClick={() => select(n)}
                      aria-label={`${SEVERITY_LABEL[n.severity]}: ${n.title}${n.read ? '' : ' (unread)'}${onMap(n) ? '. Show on map' : ''}`}
                    >
                      <span className={`block break-words ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                      {n.message && (
                        <span className="block break-words text-xs text-slate-700">{n.message}</span>
                      )}
                      <span className="block text-xs text-slate-500">
                        {SEVERITY_LABEL[n.severity]} · {new Date(n.updatedAt).toLocaleTimeString()}
                        {n.count > 1 ? ` · ${n.count}×` : ''}
                        {onMap(n) ? ' · Show on map' : ''}
                      </span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="self-start text-xs text-slate-600 hover:text-slate-900"
                    aria-label={`Dismiss notification: ${n.title}`}
                    onClick={() => dismiss(n.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-slate-200 p-2 text-xs text-slate-500">
            Kept for this browser session only.
          </p>
        </section>
      )}
    </div>
  );
}
