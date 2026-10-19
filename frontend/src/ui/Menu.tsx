/**
 * Accessible dropdown menu (WAI-ARIA menu button pattern).
 *
 * Keyboard: Enter / Space / ArrowDown open and focus the first item, ArrowUp opens
 * on the last; ArrowUp/ArrowDown/Home/End move; Escape or Tab closes and returns
 * focus to the button. Clicking outside closes it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type MenuEntry =
  | { kind: 'item'; label: string; onSelect: () => void; hint?: string; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string };

export function Menu({ label, entries, icon }: { label: string; entries: MenuEntry[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [focusIndex, setFocusIndex] = useState(0);
  const items = entries.filter((e): e is Extract<MenuEntry, { kind: 'item' }> => e.kind === 'item');

  const focusItem = (index: number) => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    const target = enabled.includes(wrapped) ? wrapped : enabled[0]!;
    setFocusIndex(target);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const nodes = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    nodes?.[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      focusItem(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      focusItem(items.length - 1);
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowDown: () => focusItem(focusIndex + 1),
      ArrowUp: () => focusItem(focusIndex - 1),
      Home: () => focusItem(0),
      End: () => focusItem(items.length - 1),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const move = moves[e.key];
    if (move) {
      if (e.key !== 'Tab') e.preventDefault();
      move();
    }
  };

  let itemIndex = -1;
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen(!open);
          focusItem(0);
        }}
        onKeyDown={onButtonKey}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-slate-800 hover:bg-slate-100 ${open ? 'bg-slate-100' : ''}`}
      >
        {icon}
        {label}
        <span aria-hidden className="text-xs text-slate-500">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="absolute end-0 z-50 mt-1 min-w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {entries.map((entry, i) => {
            if (entry.kind === 'separator')
              return <div key={i} role="separator" className="my-1 border-t border-slate-200" />;
            if (entry.kind === 'heading') {
              return (
                <div
                  key={i}
                  role="presentation"
                  className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {entry.label}
                </div>
              );
            }
            itemIndex += 1;
            const idx = itemIndex;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={idx === focusIndex ? 0 : -1}
                disabled={entry.disabled}
                onClick={() => {
                  close();
                  entry.onSelect();
                }}
                onMouseEnter={() => setFocusIndex(idx)}
                className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-start text-sm text-slate-900 hover:bg-slate-100 focus:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>{entry.label}</span>
                {entry.hint && <span className="text-xs text-slate-500">{entry.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
