/** Energy of one round trip of a line from train physics (R15b), estimated under the vehicle's inputs. */
import { useMemo } from 'react';
import type { Scenario, TransportLine } from '../domain/schema';
import { buildLineModel } from '../simulation/engine';
import { lineRoundTripEnergy } from '../simulation/energy';

const kwh = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)} kWh`;

export function LineEnergy({ line, scenario }: { line: TransportLine; scenario: Scenario }) {
  const energy = useMemo(() => {
    const model = buildLineModel(line, scenario);
    return model ? lineRoundTripEnergy(model, line, scenario) : null;
  }, [line, scenario]);
  if (!energy) return null;
  const perKm = (x: number) => (energy.distanceKm > 0 ? `${(x / energy.distanceKm).toFixed(2)} kWh/km` : '');
  return (
    <div className="mt-2 text-sm text-slate-800" data-testid="line-energy">
      <h4 className="text-xs font-medium">Energy per round trip (one vehicle, estimated)</h4>
      <ul className="list-disc ps-5">
        <li>
          Traction at the wheel: {kwh(energy.tractionAtWheelKwh)} ({perKm(energy.tractionAtWheelKwh)})
        </li>
        <li>Absorbed by braking: {kwh(energy.brakingAtWheelKwh)}</li>
        <li>
          From the supply:{' '}
          {energy.supplyKwh !== null
            ? `${kwh(energy.supplyKwh)} (${perKm(energy.supplyKwh)})`
            : `not estimated: the vehicle profile lacks ${energy.missing.join(', ')}`}
        </li>
      </ul>
      <p className="text-xs text-slate-600">
        Estimated under the selected assumptions from the forces on the train in the simulated runs (
        {energy.distanceKm.toFixed(1)} km, the line's first round trip). Not a measured value.
      </p>
    </div>
  );
}
