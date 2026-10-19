/** Small accessible building blocks. Every input has a visible label. */
import {
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-teal-800 text-white hover:bg-teal-900 border-teal-900',
  secondary: 'bg-white text-slate-900 hover:bg-slate-100 border-slate-400',
  danger: 'bg-white text-red-800 hover:bg-red-50 border-red-700',
  ghost: 'bg-transparent text-slate-900 hover:bg-slate-200 border-transparent',
};

export function Button({
  variant = 'secondary',
  className = '',
  pressed,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed ? 'bg-teal-800 text-white border-teal-900' : variants[variant]
      } ${className}`}
      {...props}
    />
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id ? `${id}-h` : undefined} className="border-b border-slate-300 p-3">
      <h2
        id={id ? `${id}-h` : undefined}
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="mb-2">
      <label htmlFor={id} className="block text-xs font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 w-full rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900"
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-600">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  options,
  hint,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-2">
      <label htmlFor={id} className="block text-xs font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 w-full rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-600">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="mb-1 flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <label htmlFor={id} className="text-sm text-slate-900">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="block text-xs text-slate-600">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

/** Badge that always carries text, so status is not conveyed by colour alone. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warn' | 'demo' | 'ok' | 'error';
}) {
  const tones = {
    neutral: 'bg-slate-200 text-slate-900 border-slate-400',
    warn: 'bg-amber-100 text-amber-950 border-amber-700',
    demo: 'bg-fuchsia-100 text-fuchsia-950 border-fuchsia-700',
    ok: 'bg-emerald-100 text-emerald-950 border-emerald-700',
    error: 'bg-red-100 text-red-950 border-red-700',
  };
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
