/** Vehicle profiles: list, edit and add user-defined profiles per mode. */
import { useState, type FormEvent } from 'react';
import type { TransportMode, VehicleCategory, VehicleType } from '../domain/schema';
import { MODES, MODE_LIST } from '../domain/modes';
import {
  addVehicleProfile,
  deleteVehicleProfile,
  linesUsingVehicle,
  MODE_VEHICLE_CATEGORIES,
  updateVehicleProfile,
  usesVehicles,
  VEHICLE_CATEGORY_LABELS,
  vehicleModes,
} from '../domain/vehicles';
import { useScenario, useStore } from '../store/projectStore';
import { CommitField } from './CommitField';
import { Badge, Button, SelectField, Section } from './primitives';

const ENERGY_LABELS: Record<VehicleType['energy'], string> = {
  electric_overhead: 'Electric, overhead line',
  electric_third_rail: 'Electric, third rail',
  battery: 'Battery',
  diesel: 'Diesel',
  hybrid: 'Hybrid',
  gas: 'Gas',
  hydrogen: 'Hydrogen',
  unknown: 'Not specified',
};

const VEHICLE_MODES = MODE_LIST.filter(usesVehicles);

/** Number field committing a nullable number. */
function NumberField({
  label,
  unit,
  value,
  onCommit,
  min = 0,
  integer = false,
  required = false,
}: {
  label: string;
  unit?: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  integer?: boolean;
  required?: boolean;
}) {
  return (
    <CommitField
      label={label}
      unit={unit}
      type="number"
      min={min}
      step={integer ? 1 : 'any'}
      value={value}
      onCommit={(v) => {
        if (v === '') return required ? 'Required' : onCommit(null);
        const n = Number(v);
        if (integer && !Number.isInteger(n)) return 'Whole numbers only';
        if (required && !(n > 0)) return 'Must be above 0';
        onCommit(n);
      }}
    />
  );
}

function ProfileEditor({ v }: { v: VehicleType }) {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const used = linesUsingVehicle(scenario, v.id);
  const patch = (p: Partial<VehicleType>) =>
    commit(updateVehicleProfile(scenario, v.id, p), 'Vehicle profile changed');
  return (
    <div className="mt-1 space-y-1">
      <CommitField
        label="Name"
        value={v.name}
        onCommit={(x) => (x.trim() ? patch({ name: x.trim() }) : 'Required')}
      />
      <SelectField
        label="Category"
        value={v.category}
        onChange={(e) => patch({ category: e.target.value as VehicleCategory })}
        options={MODE_VEHICLE_CATEGORIES[v.mode].map((c) => ({
          value: c,
          label: VEHICLE_CATEGORY_LABELS[c],
        }))}
      />
      <fieldset>
        <legend className="text-xs font-medium text-slate-800">Also usable on</legend>
        {VEHICLE_MODES.filter((m) => m !== v.mode).map((m) => {
          const id = `vt-${v.id}-mode-${m}`;
          return (
            <label key={m} htmlFor={id} className="me-2 inline-flex items-center gap-1 text-xs">
              <input
                id={id}
                type="checkbox"
                checked={v.compatibleModes.includes(m)}
                onChange={(e) =>
                  patch({
                    compatibleModes: e.target.checked
                      ? [...v.compatibleModes, m]
                      : v.compatibleModes.filter((x) => x !== m),
                  })
                }
              />
              {MODES[m].label}
            </label>
          );
        })}
      </fieldset>
      <div className="grid grid-cols-2 gap-x-2">
        <NumberField
          label="Capacity"
          unit="passengers"
          integer
          required
          value={v.capacity}
          onCommit={(n) => n && patch({ capacity: n })}
        />
        <NumberField
          label="Seats"
          integer
          value={v.seatedCapacity}
          onCommit={(n) => patch({ seatedCapacity: n })}
        />
        <NumberField
          label="Length per unit"
          unit="m"
          required
          value={v.lengthM}
          onCommit={(n) => n && patch({ lengthM: n })}
        />
        <NumberField label="Width" unit="m" value={v.widthM} onCommit={(n) => patch({ widthM: n })} />
        <NumberField
          label="Units per consist"
          integer
          min={1}
          required
          value={v.unitsPerConsist}
          onCommit={(n) => n && patch({ unitsPerConsist: n })}
        />
        <NumberField
          label="Doors (per unit)"
          integer
          value={v.doorCount}
          onCommit={(n) => patch({ doorCount: n })}
        />
        <NumberField
          label="Maximum speed"
          unit="km/h"
          required
          value={v.maxSpeedKmh}
          onCommit={(n) => n && patch({ maxSpeedKmh: n })}
        />
        <NumberField
          label="Acceleration"
          unit="m/s²"
          value={v.accelerationMs2}
          onCommit={(n) => patch({ accelerationMs2: n })}
        />
        <NumberField
          label="Service braking"
          unit="m/s²"
          value={v.serviceBrakingMs2}
          onCommit={(n) => patch({ serviceBrakingMs2: n })}
        />
        <NumberField
          label="Minimum curve radius"
          unit="m"
          value={v.minRadiusM}
          onCommit={(n) => patch({ minRadiusM: n })}
        />
        <NumberField
          label="Track gauge"
          unit="mm"
          integer
          value={v.gaugeMm}
          onCommit={(n) => patch({ gaugeMm: n })}
        />
        <NumberField
          label="Maximum grade"
          unit="%"
          value={v.maxGradePercent}
          onCommit={(n) => patch({ maxGradePercent: n })}
        />
      </div>
      <SelectField
        label="Energy"
        value={v.energy}
        onChange={(e) => patch({ energy: e.target.value as VehicleType['energy'] })}
        options={Object.entries(ENERGY_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <CommitField
        label="Compatible platforms"
        value={v.compatiblePlatforms.join(', ')}
        hint="Comma-separated, e.g. low-floor 30 cm"
        onCommit={(x) =>
          patch({
            compatiblePlatforms: x
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
          })
        }
      />
      <CommitField
        label="Source"
        value={v.source}
        onCommit={(x) => patch({ source: x.trim() || 'Entered by the user' })}
      />
      <CommitField label="Notes" value={v.notes} onCommit={(x) => patch({ notes: x })} />
      <Button
        variant="danger"
        disabled={used.length > 0}
        onClick={() => commit(deleteVehicleProfile(scenario, v.id), 'Vehicle profile deleted')}
      >
        Delete profile
      </Button>
      {used.length > 0 && (
        <p className="text-xs text-slate-600">
          Used by {used.length} line(s); choose another vehicle there first.
        </p>
      )}
    </div>
  );
}

export function VehicleProfilesPanel() {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const [mode, setMode] = useState<TransportMode>('bus');
  const [category, setCategory] = useState<VehicleCategory>(MODE_VEHICLE_CATEGORIES.bus[0]!);
  const [form, setForm] = useState({ name: '', capacity: '', maxSpeedKmh: '', lengthM: '', source: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const res = addVehicleProfile(scenario, {
      name: form.name,
      mode,
      category,
      capacity: Number(form.capacity),
      maxSpeedKmh: Number(form.maxSpeedKmh),
      lengthM: Number(form.lengthM),
      source: form.source,
    });
    setErrors(res.errors);
    if (!res.errors.length) {
      commit(res.scenario, `Vehicle profile "${res.vehicle!.name}" added`);
      setForm({ name: '', capacity: '', maxSpeedKmh: '', lengthM: '', source: '' });
    }
  };
  const field = (key: keyof typeof form, label: string, type = 'number') => (
    <div>
      <label htmlFor={`new-vt-${key}`} className="block text-xs font-medium text-slate-800">
        {label}
      </label>
      <input
        id={`new-vt-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded border border-slate-500 px-1 py-0.5 text-sm"
      />
    </div>
  );
  return (
    <Section
      title={`Vehicle profiles (${scenario.vehicleTypes.length})`}
      id="vehicle-profiles"
      collapsible
      defaultOpen={false}
    >
      <p className="mb-1 text-xs text-slate-600">
        A line can only use vehicles of its mode. Unknown values stay empty; built-in profiles are
        placeholders.
      </p>
      <ul className="mb-2 space-y-1">
        {scenario.vehicleTypes.map((v) => (
          <li key={v.id}>
            <details
              onToggle={(e) => setOpenId((e.currentTarget as HTMLDetailsElement).open ? v.id : null)}
              open={openId === v.id}
            >
              <summary className="cursor-pointer text-sm">
                {v.name}{' '}
                <span className="text-xs text-slate-600">
                  {vehicleModes(v)
                    .map((m) => MODES[m].label)
                    .join(', ')}
                </span>{' '}
                {v.status === 'demonstration' && <Badge>Placeholder</Badge>}
              </summary>
              {/* Rendered only while open: one editor at a time keeps the panel light. */}
              {openId === v.id && <ProfileEditor v={v} />}
            </details>
          </li>
        ))}
      </ul>
      <form
        onSubmit={submit}
        className="rounded border border-slate-200 p-2"
        aria-label="Add a vehicle profile"
      >
        <p className="mb-1 text-xs font-semibold">Add a vehicle profile</p>
        <SelectField
          label="Mode of the new vehicle"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as TransportMode;
            setMode(m);
            setCategory(MODE_VEHICLE_CATEGORIES[m][0]!);
          }}
          options={VEHICLE_MODES.map((m) => ({ value: m, label: MODES[m].label }))}
        />
        <SelectField
          label="Vehicle category"
          value={category}
          onChange={(e) => setCategory(e.target.value as VehicleCategory)}
          options={MODE_VEHICLE_CATEGORIES[mode].map((c) => ({
            value: c,
            label: VEHICLE_CATEGORY_LABELS[c],
          }))}
        />
        {field('name', 'Vehicle name', 'text')}
        <div className="grid grid-cols-3 gap-1">
          {field('capacity', 'Capacity')}
          {field('maxSpeedKmh', 'Max km/h')}
          {field('lengthM', 'Length m')}
        </div>
        {field('source', 'Source (e.g. manufacturer data sheet)', 'text')}
        {errors.length > 0 && (
          <ul role="alert" className="text-xs text-red-800">
            {errors.map((er) => (
              <li key={er}>⛔ {er}</li>
            ))}
          </ul>
        )}
        <Button type="submit" variant="primary" className="mt-1">
          Add profile
        </Button>
      </form>
    </Section>
  );
}
