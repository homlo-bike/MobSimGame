/** Floating info window of a vehicle (F4), next to it on the map; refreshed while it moves. */
import { useEffect } from 'react';
import type { VehicleInfo } from '../simulation/vehicleInfo';

export function VehiclePanel({
  info,
  x,
  y,
  onClose,
}: {
  info: VehicleInfo;
  x: number;
  y: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <section
      aria-label={`Vehicle ${info.code}`}
      className="absolute z-10 w-64 rounded border border-slate-400 bg-white p-2 text-sm shadow-lg"
      style={{ left: x + 14, top: y - 14 }}
      data-testid="vehicle-panel"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="font-mono font-semibold">{info.code}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close vehicle information"
          className="rounded px-1 hover:bg-slate-100"
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-slate-600">Line</dt>
        <dd>
          <span
            aria-hidden
            className="me-1 inline-block h-2 w-4 rounded-sm"
            style={{ background: info.color }}
          />
          {info.lineName}
        </dd>
        <dt className="text-slate-600">Status</dt>
        <dd>{info.status}</dd>
        <dt className="text-slate-600">Next stop</dt>
        <dd>{info.nextStop ?? '–'}</dd>
        <dt className="text-slate-600">Load</dt>
        <dd>
          {info.load.kind === 'estimate' ? (
            <>
              {info.load.percent} % of capacity ({info.load.passengers} of {info.load.capacity}){' '}
              <span className="block text-xs text-slate-600">
                Estimated at the busiest point from the expected {info.load.basis} demand you entered.
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-600">{info.load.reason}</span>
          )}
        </dd>
      </dl>
    </section>
  );
}
