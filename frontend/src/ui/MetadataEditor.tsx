/** Custom key/value fields for projects, lines, stations, tracks and nodes. */
import { useState } from 'react';
import type { Metadata } from '../domain/schema';
import { CommitField } from './CommitField';
import { Button } from './primitives';

export function MetadataEditor({
  value,
  onChange,
  idPrefix,
}: {
  value: Metadata;
  onChange: (next: Metadata) => void;
  idPrefix: string;
}) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(value);
  const add = () => {
    const k = key.trim();
    if (!k) return setError('Enter a field name.');
    if (k in value) return setError(`"${k}" already exists; edit it above.`);
    onChange({ ...value, [k]: val });
    setKey('');
    setVal('');
    setError(null);
  };
  return (
    <div>
      {entries.length === 0 && <p className="mb-1 text-xs text-slate-600">No custom fields yet.</p>}
      <ul className="space-y-1">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-end gap-1">
            <div className="flex-1">
              <CommitField label={k} value={v} onCommit={(nv) => onChange({ ...value, [k]: nv })} />
            </div>
            <Button
              variant="ghost"
              className="mb-2"
              aria-label={`Remove field ${k}`}
              onClick={() => {
                const next = { ...value };
                delete next[k];
                onChange(next);
              }}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-1">
        <div>
          <label htmlFor={`${idPrefix}-meta-key`} className="block text-xs font-medium text-slate-800">
            New field name
          </label>
          <input
            id={`${idPrefix}-meta-key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-28 rounded border border-slate-500 px-1 py-0.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-meta-value`} className="block text-xs font-medium text-slate-800">
            Value
          </label>
          <input
            id={`${idPrefix}-meta-value`}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="w-28 rounded border border-slate-500 px-1 py-0.5 text-sm"
          />
        </div>
        <Button onClick={add}>Add field</Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
