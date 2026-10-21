/** Application settings of this browser (not saved in the project): notifications. */
import { useEffect, useRef } from 'react';
import { useNotificationSettings, type SettingLevel } from '../store/notificationSettings';
import { Button, Checkbox } from './primitives';

const LEVELS: { id: SettingLevel; label: string }[] = [
  { id: 'info', label: 'Information (and confirmations)' },
  { id: 'warning', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { settings, set, reset } = useNotificationSettings();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="settings-title"
      className="m-auto w-[min(28rem,92vw)] rounded border border-slate-400 p-0 backdrop:bg-black/40"
      data-testid="settings-dialog"
    >
      <div className="p-4">
        <h2 id="settings-title" className="mb-1 text-lg font-semibold">
          Settings
        </h2>
        <p className="mb-3 text-sm text-slate-700">
          Settings of this browser; they are not saved in the project.
        </p>
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-semibold">Notifications</legend>
          {LEVELS.map((l) => (
            <div key={l.id} className="mb-2 rounded border border-slate-200 p-2">
              <p className="mb-1 text-sm font-medium">{l.label}</p>
              <Checkbox
                label="Show as a pop-up"
                checked={settings[l.id].popup}
                onChange={(v) => set(l.id, { popup: v })}
              />
              {l.id === 'error' ? (
                <p className="text-xs text-slate-600">Errors are always kept in the notification list.</p>
              ) : (
                <Checkbox
                  label="Keep in the notification list"
                  checked={settings[l.id].keep}
                  onChange={(v) => set(l.id, { keep: v })}
                />
              )}
            </div>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button onClick={reset}>Reset to defaults</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
