/** Transient feedback for the latest notification; it is also kept in the notification centre. */
import { useEffect } from 'react';
import { useNotifications, type NotificationSeverity } from '../store/notifications';

export const SEVERITY_SYMBOL: Record<NotificationSeverity, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '⛔',
};

export const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: 'Information',
  success: 'Done',
  warning: 'Warning',
  error: 'Error',
};

const TONE: Record<NotificationSeverity, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-950',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  warning: 'border-amber-400 bg-amber-50 text-amber-950',
  error: 'border-red-300 bg-red-50 text-red-950',
};

/** Successes and information fade after 6 s; warnings and errors stay until dismissed. */
export function Toast() {
  const toast = useNotifications((s) => s.toast);
  const dismiss = useNotifications((s) => s.dismissToast);
  useEffect(() => {
    if (!toast || toast.severity === 'error' || toast.severity === 'warning') return;
    const id = setTimeout(dismiss, 6000);
    return () => clearTimeout(id);
  }, [toast, dismiss]);
  if (!toast) return null;
  const urgent = toast.severity === 'error' || toast.severity === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`fixed bottom-16 end-4 z-50 flex max-w-md items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg ${TONE[toast.severity]}`}
    >
      <span className="flex-1 break-words">
        <span aria-hidden>{SEVERITY_SYMBOL[toast.severity]} </span>
        <span className="sr-only">{SEVERITY_LABEL[toast.severity]}: </span>
        {toast.title}
        {toast.message && <span className="block text-xs">{toast.message}</span>}
      </span>
      <button type="button" className="text-xs underline" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
