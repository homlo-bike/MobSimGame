import { useEffect, useId, useState } from 'react';

/**
 * Text/number input that commits on blur or Enter, so typing does not create
 * one undo step per keystroke. Invalid numbers are reported, not committed.
 */
export function CommitField({
  label,
  value,
  onCommit,
  type = 'text',
  min,
  max,
  step,
  hint,
  unit,
  inline = false,
}: {
  label: string;
  value: string | number | null;
  onCommit: (v: string) => string | null | void;
  type?: 'text' | 'number' | 'time';
  min?: number;
  max?: number;
  step?: number | 'any';
  hint?: string;
  unit?: string;
  /** Borderless, label visually hidden (still read by screen readers). For headers. */
  inline?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value === null ? '' : String(value));
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft === (value === null ? '' : String(value))) return;
    if (type === 'number' && draft !== '') {
      const n = Number(draft);
      if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
        setError(
          `Enter a number${min !== undefined ? ` ≥ ${min}` : ''}${max !== undefined ? ` and ≤ ${max}` : ''}.`,
        );
        return;
      }
    }
    const err = onCommit(draft);
    setError(err ?? null);
  };
  return (
    <div className={inline ? 'relative' : 'mb-2'}>
      <label htmlFor={id} className={inline ? 'sr-only' : 'block text-xs font-medium text-slate-800'}>
        {label}
        {unit ? ` (${unit})` : ''}
      </label>
      <input
        id={id}
        type={type}
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${error ? `${id}-err ` : ''}${hint ? `${id}-hint` : ''}`.trim() || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className={
          inline
            ? 'w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-slate-900 hover:border-slate-300 focus:border-slate-500 focus:bg-white aria-[invalid=true]:border-red-700'
            : 'mt-0.5 w-full rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900 aria-[invalid=true]:border-red-700'
        }
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-err`}
          role="alert"
          className={`mt-0.5 text-xs font-semibold text-red-800 ${inline ? 'absolute start-0 top-full z-10 rounded bg-white px-1 shadow' : ''}`}
        >
          ⛔ {error}
        </p>
      )}
    </div>
  );
}
