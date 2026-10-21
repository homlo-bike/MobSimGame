import { useEffect, useMemo, useState } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { analyseScenario } from '../analysis/demoAnalysis';
import { formatRange } from '../analysis/ranges';
import { formatDistance } from '../analysis/units';
import { isRing, lineLengthM, orderedStops } from '../domain/network';
import { samplePath } from '../geo/geometry';
import { gradeSummary, validateScenario, type ElevationProfile } from '../validation/validate';
import { mockProviders } from '../providers/registry';
import { RangeChart } from './RangeChart';
import { ValidationSummary } from './FindingsList';
import { Badge, Section } from './primitives';
import { OperationsReportSection } from './OperationsReport';

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded border border-slate-300 bg-white p-2">
      <p className="text-xs text-slate-700">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      <p className="text-xs text-slate-600">{note}</p>
    </div>
  );
}

/**
 * Real places never show synthetic figures: only quantities calculated from the
 * drawn network, and an "input required" state for everything that needs local data.
 */
function RealPlaceDashboard() {
  const scenario = useScenario();
  const unitSystem = useStore((s) => s.unitSystem);
  const findings = useMemo(() => validateScenario(scenario), [scenario]);
  const lines = scenario.lines.map((l) => {
    const stops = orderedStops(l, scenario.stations);
    const len = lineLengthM(l);
    const spacing = stops.length > 1 ? len / (stops.length - (isRing(l) ? 0 : 1)) : null;
    return { line: l, len, stops: stops.length, spacing };
  });
  const total = lines.reduce((s, x) => s + x.len, 0);
  const served = new Set(scenario.lines.flatMap((l) => l.stops.map((s) => s.stationId)));
  const interchanges = scenario.stations.filter(
    (st) => scenario.lines.filter((l) => l.stops.some((x) => x.stationId === st.id)).length >= 2,
  ).length;
  return (
    <div className="h-full overflow-auto bg-slate-50 p-3">
      <div
        role="note"
        className="mb-3 rounded border-2 border-amber-600 bg-amber-50 p-3 text-sm text-amber-950"
      >
        <p className="font-bold">Input required: no figures are estimated for real places yet.</p>
        <p>
          Ridership, capacity use, costs and emissions need local data (population, travel demand, unit costs,
          emission factors). MobSimGame does not substitute synthetic values for a real place. The figures
          below are calculated from the network geometry only.
        </p>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Scenario: {scenario.name}</h2>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile
          label="Route length"
          value={formatDistance(total, unitSystem)}
          note="Calculated from geometry"
        />
        <StatTile label="Stations" value={String(served.size)} note="Shared stations counted once" />
        <StatTile label="Interchanges" value={String(interchanges)} note="Stations on ≥ 2 lines" />
        <div className="rounded border border-slate-300 bg-white p-2 md:col-span-2">
          <p className="mb-1 text-xs text-slate-700">Validation</p>
          <ValidationSummary findings={findings} />
        </div>
      </div>
      <Section title="Lines (calculated from geometry)" id="dash-lines">
        <table className="w-full text-sm">
          <caption className="sr-only">Length, stations and mean stop spacing per line</caption>
          <thead>
            <tr>
              <th scope="col" className="text-start">
                Line
              </th>
              <th scope="col" className="text-end">
                Length
              </th>
              <th scope="col" className="text-end">
                Stations
              </th>
              <th scope="col" className="text-end">
                Mean stop spacing
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ line, len, stops, spacing }) => (
              <tr key={line.id}>
                <th scope="row" className="text-start font-normal">
                  <span
                    aria-hidden
                    className="me-1 inline-block h-2 w-3"
                    style={{ background: line.color }}
                  />
                  {line.name}
                </th>
                <td className="text-end">{formatDistance(len, unitSystem)}</td>
                <td className="text-end">{stops}</td>
                <td className="text-end">{spacing === null ? '–' : formatDistance(spacing, unitSystem)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <OperationsReportSection scenario={scenario} />
      <Section title="Estimates" id="dash-estimates">
        <ul className="list-disc ps-5 text-sm">
          {['Weekday boardings', 'Peak capacity use', 'Capital cost', 'Operating cost', 'Emissions'].map(
            (x) => (
              <li key={x}>
                {x}: <Badge tone="warn">Input required</Badge>
              </li>
            ),
          )}
        </ul>
        <p className="mt-1 text-xs text-slate-600">
          Editable, sourced assumption sets for real places are planned (Phase 4).
        </p>
      </Section>
    </div>
  );
}

export function Dashboard() {
  const project = useStore((s) => s.project);
  return project.fictional ? <DemoDashboard /> : <RealPlaceDashboard />;
}

function DemoDashboard() {
  const scenario = useScenario();
  const project = useStore((s) => s.project);
  const unitSystem = useStore((s) => s.unitSystem);
  const analysis = useMemo(() => analyseScenario(scenario), [scenario]);
  const comparisons = useMemo(
    () => project.scenarios.map((s) => ({ s, a: analyseScenario(s) })),
    [project.scenarios],
  );
  const findings = useMemo(() => validateScenario(scenario), [scenario]);
  const lineName = (id: string) => scenario.lines.find((l) => l.id === id)?.name ?? id;
  const lineColor = (id: string) => scenario.lines.find((l) => l.id === id)?.color;
  const rows = (f: (m: (typeof analysis.lines)[number]) => { low: number; central: number; high: number }) =>
    analysis.lines.map((m) => ({
      id: m.lineId,
      label: lineName(m.lineId),
      swatch: lineColor(m.lineId),
      value: f(m),
    }));

  const [profiles, setProfiles] = useState<Record<string, ElevationProfile>>({});
  useEffect(() => {
    if (!project.fictional) {
      setProfiles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const out: Record<string, ElevationProfile> = {};
      for (const l of scenario.lines) {
        const samples = samplePath(l.coordinates, isRing(l), 100);
        const res = await mockProviders.elevation.elevations(samples.map((s) => s.position));
        out[l.id] = samples.map((s, i) => ({ chainageM: s.chainageM, elevationM: res.data[i]! }));
      }
      if (!cancelled) setProfiles(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [scenario, project.fictional]);

  const topStations = [...analysis.stations]
    .sort((a, b) => b.weekdayBoardings.central - a.weekdayBoardings.central)
    .slice(0, 12);

  return (
    <div className="h-full overflow-auto bg-slate-50 p-3">
      <div
        role="note"
        className="mb-3 rounded border-2 border-fuchsia-700 bg-fuchsia-50 p-3 text-sm text-fuchsia-950"
      >
        <p className="font-bold">
          DEMONSTRATION DATA: synthetic assumptions, uncalibrated, exploratory only.
        </p>
        <p>
          The calculations are deterministic and their formulas are shown, but every input (
          {analysis.assumptionSet.name}, v{analysis.assumptionSet.version}) is a synthetic placeholder. Costs
          are in fictional “demo units” ({analysis.currency}), not money. Population comes from a synthetic
          density surface. Do not use these figures for decisions. Boardings are trips, not unique people.
        </p>
      </div>

      <h2 className="mb-2 text-lg font-semibold">
        Scenario: {scenario.name} {project.fictional && <Badge tone="demo">Fictional</Badge>}
      </h2>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <StatTile
          label="Route length"
          value={formatDistance(analysis.totals.lengthM, unitSystem)}
          note="Calculated from geometry"
        />
        <StatTile
          label="Stations"
          value={String(analysis.totals.stations)}
          note="Shared stations counted once"
        />
        <StatTile
          label="Interchanges"
          value={String(analysis.totals.interchanges)}
          note="Stations on ≥ 2 lines"
        />
        <StatTile
          label="Vehicles in service"
          value={String(analysis.totals.vehicles)}
          note="Placeholder speeds and peak headway"
        />
        <div className="rounded border border-slate-300 bg-white p-2 md:col-span-2">
          <p className="mb-1 text-xs text-slate-700">Validation</p>
          <ValidationSummary findings={findings} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <RangeChart
          title="Weekday boardings by line"
          unit="boardings/weekday"
          rows={rows((m) => m.weekdayBoardings)}
          note="Formula: Σ stations (residents × trips/resident + jobs × trips/job) × transit share; interchange boardings split between lines."
        />
        <RangeChart
          title="Peak capacity utilisation"
          unit="ratio (1 = full)"
          digits={2}
          rows={rows((m) => m.capacityUtilisation)}
          note="Peak load ≈ 10 % of weekday boardings × 60 % peak direction (synthetic factors) ÷ (60 / headway × vehicle capacity)."
        />
        <RangeChart
          title="Capital cost by line"
          unit={analysis.currency}
          rows={rows((m) => m.capex)}
          note="(Σ route-km by structure × unit cost + stations × unit cost) × (1 + contingency). Shared stations costed once."
        />
        <RangeChart
          title="Annual operating cost by line"
          unit={`${analysis.currency}/year`}
          digits={1}
          rows={rows((m) => m.annualOpex)}
          note="Vehicle-km × cost/vehicle-km + vehicle-hours × cost/vehicle-hour."
        />
        <RangeChart
          title="Car trips replaced per weekday"
          unit="car trips/weekday"
          rows={rows((m) => m.carTripsShiftedPerDay)}
          note="Boardings × share who previously drove ÷ car occupancy. Not every rider previously drove. Induced traffic is not modelled."
        />
        <RangeChart
          title="Net operational CO₂e change"
          unit="t CO₂e/year (negative = reduction)"
          rows={rows((m) => m.netCo2eTonnesPerYear)}
          note="Transit energy × grid intensity − avoided car km × car factor. Excludes construction (embodied) emissions. Estimated change under the selected assumptions, not a measured air-quality effect."
        />
        <RangeChart
          title="Parking area equivalent"
          unit="m²"
          rows={rows((m) => m.parkingAreaEquivalentM2)}
          note="Theoretical equivalent area of parking no longer needed; not reclaimable or redesigned space."
        />
        <RangeChart
          title="Weekday boardings by station (top 12)"
          unit="boardings/weekday"
          rows={topStations.map((s) => ({
            id: s.stationId,
            label: scenario.stations.find((x) => x.id === s.stationId)?.name ?? s.stationId,
            value: s.weekdayBoardings,
          }))}
          note="Catchments overlapping between stations are assigned to the nearest station (no double counting)."
        />
      </div>

      {Object.keys(profiles).length > 0 && (
        <Section title="Terrain profile summary (synthetic elevation)" id="terrain">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  Line
                </th>
                <th scope="col" className="text-end">
                  Max grade
                </th>
                <th scope="col" className="text-end">
                  Mean grade
                </th>
                <th scope="col" className="text-end">
                  Cumulative gain
                </th>
              </tr>
            </thead>
            <tbody>
              {scenario.lines.map((l) => {
                const p = profiles[l.id];
                if (!p) return null;
                const g = gradeSummary(p);
                return (
                  <tr key={l.id}>
                    <th scope="row" className="text-start font-normal">
                      {l.name}
                    </th>
                    <td className="text-end">{g.maxGradePercent.toFixed(1)} %</td>
                    <td className="text-end">{g.meanGradePercent.toFixed(1)} %</td>
                    <td className="text-end">{Math.round(g.cumulativeGainM)} m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-slate-600">
            Ground-surface grades from a synthetic surface sampled every 100 m; not a vertical alignment
            design.
          </p>
        </Section>
      )}

      <Section title="Scenario comparison" id="compare">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  Scenario
                </th>
                <th scope="col" className="text-end">
                  Length
                </th>
                <th scope="col" className="text-end">
                  Stations
                </th>
                <th scope="col" className="text-end">
                  Annual boardings
                </th>
                <th scope="col" className="text-end">
                  Capital cost ({analysis.currency})
                </th>
                <th scope="col" className="text-end">
                  Net CO₂e (t/yr)
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map(({ s, a }) => (
                <tr key={s.id} className={s.id === scenario.id ? 'font-semibold' : ''}>
                  <th scope="row" className="text-start font-normal">
                    {s.name}
                  </th>
                  <td className="text-end">{formatDistance(a.totals.lengthM, unitSystem)}</td>
                  <td className="text-end">{a.totals.stations}</td>
                  <td className="text-end">{formatRange(a.totals.annualBoardings, '', 0)}</td>
                  <td className="text-end">{formatRange(a.totals.capex, '', 0)}</td>
                  <td className="text-end">{formatRange(a.totals.netCo2eTonnesPerYear, '', 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Line summary" id="line-summary">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  Line
                </th>
                <th scope="col" className="text-end">
                  Length
                </th>
                <th scope="col" className="text-end">
                  Stations
                </th>
                <th scope="col" className="text-end">
                  Run speed
                </th>
                <th scope="col" className="text-end">
                  Cycle
                </th>
                <th scope="col" className="text-end">
                  Vehicles
                </th>
                <th scope="col" className="text-end">
                  Capacity
                </th>
              </tr>
            </thead>
            <tbody>
              {analysis.lines.map((m) => (
                <tr key={m.lineId}>
                  <th scope="row" className="text-start font-normal">
                    {lineName(m.lineId)}
                  </th>
                  <td className="text-end">
                    {formatDistance(lineLengthM(scenario.lines.find((l) => l.id === m.lineId)!), unitSystem)}
                  </td>
                  <td className="text-end">{m.stations}</td>
                  <td className="text-end">{m.runningSpeedKmh.toFixed(0)} km/h</td>
                  <td className="text-end">{m.cycleTimeMin.toFixed(0)} min</td>
                  <td className="text-end">{m.vehiclesRequired}</td>
                  <td className="text-end">{Math.round(m.capacityPphpd).toLocaleString()} pphpd</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-600">
          Running speed = min(limits) × right-of-way factor (placeholder: 0.40 mixed traffic, 0.60 dedicated
          lane, 0.75 dedicated track). Vehicles = ⌈cycle time ÷ peak headway⌉. Capacity = 60 ÷ headway ×
          vehicle capacity (placeholder vehicle types).
        </p>
      </Section>

      <Section title={`Assumptions (${analysis.assumptionSet.assumptions.length})`} id="assumptions">
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th scope="col" className="text-start">
                  Assumption
                </th>
                <th scope="col" className="text-end">
                  Low
                </th>
                <th scope="col" className="text-end">
                  Central
                </th>
                <th scope="col" className="text-end">
                  High
                </th>
                <th scope="col" className="text-start ps-2">
                  Unit
                </th>
                <th scope="col" className="text-start">
                  Status
                </th>
                <th scope="col" className="text-start">
                  Sensitivity
                </th>
              </tr>
            </thead>
            <tbody>
              {analysis.assumptionSet.assumptions.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="text-start font-normal">
                    {a.label}
                  </th>
                  <td className="text-end">{a.value.low}</td>
                  <td className="text-end">{a.value.central}</td>
                  <td className="text-end">{a.value.high}</td>
                  <td className="ps-2">{a.unit}</td>
                  <td>
                    <Badge tone="demo">{a.status}</Badge>
                  </td>
                  <td>{a.sensitivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          Source for every row: {analysis.assumptionSet.assumptions[0]?.source} Editing assumptions is planned
          for Phase 4.
        </p>
      </Section>
    </div>
  );
}
