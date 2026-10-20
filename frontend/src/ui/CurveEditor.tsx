/**
 * Radius editor for one curve, shown on the map next to the curve: a slider and a number
 * field (keyboard path), the mode's cited minimum, and "sharp corner". Changes are committed
 * when the slider is released or the number is entered, so one adjustment is one undo step.
 */
import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { curveHandles } from '../domain/curveHandles';
import { CURVE_RADIUS_RULES } from '../domain/modeProfiles';
import { MODES } from '../domain/modes';
import { afterTrackEdit } from '../domain/serviceRouting';
import { setCurveRadius } from '../domain/tracks';
import { useScenario, useStore } from '../store/projectStore';
import { Button } from './primitives';

export function CurveEditor({ map }: { map: MlMap }) {
  const scenario = useScenario();
  const commit = useStore((s) => s.commitScenario);
  const editor = useStore((s) => s.curveEditor);
  const close = useStore((s) => s.setCurveEditor);
  const [, setFrame] = useState(0);
  const [draft, setDraft] = useState<number | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onMove = () => setFrame((f) => f + 1);
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
    };
  }, [map]);
  useEffect(() => {
    if (!editor) return;
    // Esc closes the editor (and does not reach the map's own Esc handling).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, close]);
  useEffect(() => {
    setDraft(null);
    first.current?.focus();
  }, [editor?.trackId, editor?.index]);
  if (!editor) return null;
  const net = scenario.trackNetwork;
  const track = net.tracks.find((t) => t.id === editor.trackId);
  const handle = track ? curveHandles(net, track).find((h) => h.index === editor.index) : undefined;
  if (!track || !handle) return null;
  const rule = CURVE_RADIUS_RULES[track.designMode];
  const pairIds = track.groupId
    ? net.tracks.filter((t) => t.groupId === track.groupId).map((t) => t.id)
    : [track.id];
  const min = 1;
  const max = Math.max(min + 1, handle.maxM);
  const value =
    draft ?? Math.round(handle.usedM ?? handle.requestedM ?? rule?.recommendedM ?? rule?.minimumM ?? 50);
  const apply = (r: number | null) => {
    setDraft(null);
    if (r === (track.radii[editor.index] ?? null)) return;
    commit(
      afterTrackEdit(setCurveRadius(scenario, track.id, editor.index, r), pairIds),
      r === null ? `Curve C${handle.number} removed` : `Curve C${handle.number}: radius ${r} m`,
    );
  };
  const p = map.project(handle.position as [number, number]);
  const below = rule && value < rule.minimumM;
  return (
    <div
      role="dialog"
      aria-label={`Curve C${handle.number} radius`}
      className="absolute z-20 w-64 rounded-lg border border-slate-300 bg-white p-3 text-sm shadow-lg"
      style={{ left: Math.max(8, p.x + 16), top: Math.max(8, p.y - 40) }}
    >
      <p className="mb-1 font-semibold">Curve C{handle.number}</p>
      <label htmlFor="curve-radius-range" className="block text-xs font-medium text-slate-800">
        Radius: {value} m
      </label>
      <input
        ref={first}
        id="curve-radius-range"
        type="range"
        min={min}
        max={max}
        step={value >= 100 ? 5 : 1}
        value={Math.min(value, max)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => draft !== null && apply(draft)}
        onKeyUp={() => draft !== null && apply(draft)}
        className="w-full"
      />
      <label htmlFor="curve-radius-number" className="mt-1 block text-xs font-medium text-slate-800">
        Radius in metres
      </label>
      <input
        id="curve-radius-number"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft !== null && draft > 0) apply(Math.min(draft, max));
        }}
        onBlur={() => draft !== null && draft > 0 && apply(Math.min(draft, max))}
        className="w-full rounded border border-slate-500 px-1 py-0.5"
      />
      <p className="mt-1 text-xs text-slate-600">
        Up to {max} m fits between the neighbouring curves.
        {rule &&
          ` ${MODES[track.designMode].label}: minimum ${rule.minimumM} m${rule.recommendedM ? `, recommended ${rule.recommendedM} m` : ''} (documented default).`}
      </p>
      {below && <p className="text-xs font-medium text-red-800">⛔ Below the minimum radius.</p>}
      <p className="mt-1 text-xs text-slate-600">Or drag the curve's handle on the map.</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => apply(null)}>Sharp corner</Button>
        <Button onClick={() => close(null)}>Close</Button>
      </div>
    </div>
  );
}
