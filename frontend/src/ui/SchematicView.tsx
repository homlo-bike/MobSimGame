/**
 * Schematic network map: original visual system (rounded stroke lines, white station
 * discs, black-ringed interchange capsules, terminal bars), walking links between modes
 * as dashed connectors and access symbols at stations. Stations can be selected (click
 * or Enter), dragged or nudged with the arrow keys; the view pans (drag the background)
 * and zooms (wheel or buttons). Offsets are saved with the scenario; a structured text
 * view lists every line with its stations (R11).
 */

/** Small access pictograms in the schematic (shape, not colour, carries the meaning). */
function AccessIcon({ kind, x, y }: { kind: AccessFacility; x: number; y: number }) {
  const label = { elevator: 'Elevator', escalator: 'Escalator', ramp: 'Ramp' }[kind];
  return (
    <g transform={`translate(${x} ${y})`}>
      <title>{label}</title>
      <rect width={10} height={10} fill="#ffffff" stroke="#111827" strokeWidth={1} />
      {kind === 'elevator' && <path d="M5 1.5 L7.5 4 H2.5 Z M5 8.5 L7.5 6 H2.5 Z" fill="#111827" />}
      {kind === 'escalator' && (
        <path
          d="M1.5 8.5 H3.5 V6.5 H5.5 V4.5 H7.5 V2.5 H8.5"
          fill="none"
          stroke="#111827"
          strokeWidth={1.2}
        />
      )}
      {kind === 'ramp' && <path d="M1.5 8.5 H8.5 V2.5 Z" fill="#111827" />}
    </g>
  );
}
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { computeSchematic, crossoverPoint, describeSchematic, GRID } from '../schematic/layout';
import { schematicTextView, schematicWalks } from '../schematic/textView';
import { accessFacilities, type AccessFacility } from '../domain/stationAccess';
import { Button, Section } from './primitives';
import { downloadText, safeFilename } from '../store/persistence';

export function SchematicView() {
  const scenario = useScenario();
  const project = useStore((s) => s.project);
  const commit = useStore((s) => s.commitScenario);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const layout = useMemo(() => computeSchematic(scenario, scenario.schematicOffsets), [scenario]);
  const description = useMemo(() => describeSchematic(layout), [layout]);
  const textView = useMemo(() => schematicTextView(scenario, layout), [scenario, layout]);
  const walks = useMemo(() => schematicWalks(scenario, layout), [scenario, layout]);
  // View window in schematic coordinates (pan and zoom); null = the whole map.
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // A station being dragged, or the background being panned.
  const drag = useRef<
    | { kind: 'station'; id: string; startX: number; startY: number; dx: number; dy: number; moved: boolean }
    | { kind: 'pan'; startX: number; startY: number; view: { x: number; y: number; w: number; h: number } }
    | null
  >(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const selectedStationId = selection?.kind === 'station' ? selection.id : null;

  const nudge = (id: string, dx: number, dy: number) => {
    const cur = scenario.schematicOffsets[id] ?? { dx: 0, dy: 0 };
    commit(
      {
        ...scenario,
        schematicOffsets: { ...scenario.schematicOffsets, [id]: { dx: cur.dx + dx, dy: cur.dy + dy } },
      },
      'Schematic station moved',
    );
  };
  const onKey = (id: string) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? GRID : GRID / 2;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      nudge(id, m[0], m[1]);
    }
  };

  const svgText = () => {
    const node = svgRef.current?.cloneNode(true) as SVGSVGElement | undefined;
    if (!node) return '';
    node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Exports show the whole map at its natural size, whatever the current pan and zoom.
    const fullBox = node.getAttribute('data-full-viewbox');
    if (fullBox) {
      node.setAttribute('viewBox', fullBox);
      const [, , w, hh] = fullBox.split(' ');
      node.setAttribute('width', w!);
      node.setAttribute('height', hh!);
      node.removeAttribute('data-full-viewbox');
    }
    return new XMLSerializer().serializeToString(node);
  };
  const exportPng = () => {
    const text = svgText();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = layout.width * 2;
      canvas.height = (layout.height + 60) * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${safeFilename(project.name)}-schematic.png`;
      a.click();
    };
    img.src = url;
  };

  if (layout.stations.length === 0) {
    return <p className="p-4">Add stations to lines to generate a schematic.</p>;
  }
  const h = layout.height + 60;
  const full = { x: 0, y: 0, w: layout.width, h };
  const win = view ?? full;
  const byId = new Map(
    layout.stations.map((s) => [
      s.id,
      dragOffset && dragOffset.id === s.id ? { ...s, x: s.x + dragOffset.dx, y: s.y + dragOffset.dy } : s,
    ]),
  );
  const stations = [...byId.values()];
  /** Pointer position in schematic coordinates. */
  const toSchematic = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const zoom = (factor: number, at?: { x: number; y: number }) => {
    const c = at ?? { x: win.x + win.w / 2, y: win.y + win.h / 2 };
    const w = Math.min(full.w * 4, Math.max(full.w / 20, win.w * factor));
    const k = w / win.w;
    setView({ x: c.x - (c.x - win.x) * k, y: c.y - (c.y - win.y) * k, w, h: win.h * k });
  };
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, toSchematic(e));
  };
  const onBackgroundDown = (e: PointerEvent<SVGRectElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, view: win };
  };
  const onStationDown = (id: string) => (e: PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toSchematic(e);
    drag.current = { kind: 'station', id, startX: p.x, startY: p.y, dx: 0, dy: 0, moved: false };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const svg = svgRef.current;
      const scale = svg ? d.view.w / svg.clientWidth : 1;
      setView({
        ...d.view,
        x: d.view.x - (e.clientX - d.startX) * scale,
        y: d.view.y - (e.clientY - d.startY) * scale,
      });
      return;
    }
    const p = toSchematic(e);
    // Snap the move to half grid steps, like the arrow keys.
    const step = GRID / 2;
    d.dx = Math.round((p.x - d.startX) / step) * step;
    d.dy = Math.round((p.y - d.startY) / step) * step;
    d.moved = d.moved || d.dx !== 0 || d.dy !== 0;
    setDragOffset({ id: d.id, dx: d.dx, dy: d.dy });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== 'station') return;
    setDragOffset(null);
    if (d.moved) nudge(d.id, d.dx, d.dy);
    else select({ kind: 'station', id: d.id });
  };
  return (
    <div className="h-full overflow-auto bg-white p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        <Button
          onClick={() =>
            downloadText(`${safeFilename(project.name)}-schematic.svg`, svgText(), 'image/svg+xml')
          }
        >
          Export SVG
        </Button>
        <Button onClick={exportPng}>Export PNG</Button>
        <Button onClick={() => zoom(1 / 1.4)} aria-label="Zoom in on the schematic">
          +
        </Button>
        <Button onClick={() => zoom(1.4)} aria-label="Zoom out of the schematic">
          −
        </Button>
        <Button onClick={() => setView(null)} disabled={!view}>
          Fit
        </Button>
        <Button
          onClick={() => commit({ ...scenario, schematicOffsets: {} }, 'Schematic corrections cleared')}
          disabled={!Object.keys(scenario.schematicOffsets).length}
        >
          Reset manual corrections
        </Button>
        <span className="text-sm text-slate-700">
          Click or press Enter on a station to select it; drag it or use the arrow keys to move it. Drag the
          background to pan, use the wheel or + − to zoom.
        </span>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-labelledby="schematic-title schematic-desc"
        viewBox={`${win.x} ${win.y} ${win.w} ${win.h}`}
        width="100%"
        height={Math.min(h, 640)}
        preserveAspectRatio="xMidYMid meet"
        className="max-w-none touch-none select-none rounded border border-slate-200"
        fontFamily="system-ui, sans-serif"
        onWheel={onWheel}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-full-viewbox={`0 0 ${layout.width} ${h}`}
      >
        <title id="schematic-title">Schematic network map of {scenario.name}</title>
        <desc id="schematic-desc">{description}</desc>
        <rect
          x={-layout.width * 4}
          y={-h * 4}
          width={layout.width * 9}
          height={h * 9}
          fill="#ffffff"
          onPointerDown={onBackgroundDown}
          className="cursor-grab"
        />
        {walks.map((w) => {
          const a = byId.get(w.a.id)!;
          const b = byId.get(w.b.id)!;
          return (
            <g key={w.id} aria-hidden="true">
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#475569"
                strokeWidth={3}
                strokeDasharray="2 4"
                strokeLinecap="round"
              />
              {w.minutes !== null && (
                <text
                  x={(a.x + b.x) / 2 + 4}
                  y={(a.y + b.y) / 2 + 12}
                  fontSize={10}
                  fill="#334155"
                  stroke="#ffffff"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {Math.max(1, Math.round(w.minutes))} min walk
                </text>
              )}
            </g>
          );
        })}
        {layout.lines.map((l) => (
          <polyline
            key={l.id}
            points={l.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={l.color}
            strokeWidth={8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {layout.lines.map((l) => {
          if (l.ring || l.stationIds.length < 2) return null;
          return [l.stationIds[0]!, l.stationIds[l.stationIds.length - 1]!].map((id) => {
            const s = byId.get(id)!;
            return (
              <rect key={`${l.id}-${id}`} x={s.x - 3} y={s.y - 12} width={6} height={24} fill={l.color} />
            );
          });
        })}
        {layout.lines.flatMap((l) =>
          l.crossovers.map((c) => {
            const p = crossoverPoint(layout, l, c);
            if (!p) return null;
            return (
              <g key={`xo-${l.id}-${c.stationId}-${c.side}`} aria-hidden="true">
                <circle cx={p.x} cy={p.y} r={6} fill="#ffffff" stroke="#111827" strokeWidth={1.5} />
                <path
                  d={`M${p.x - 3} ${p.y - 3} L${p.x + 3} ${p.y + 3} M${p.x + 3} ${p.y - 3} L${p.x - 3} ${p.y + 3}`}
                  stroke="#111827"
                  strokeWidth={1.5}
                />
              </g>
            );
          }),
        )}
        {stations.map((s) => (
          <g
            key={s.id}
            tabIndex={0}
            role="button"
            aria-pressed={selectedStationId === s.id}
            aria-label={`${s.name}${s.interchange ? ', interchange' : ''}${s.terminal ? ', terminal' : ''}. Enter selects it; arrow keys move it.`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                select({ kind: 'station', id: s.id });
                return;
              }
              onKey(s.id)(e);
            }}
            onPointerDown={onStationDown(s.id)}
            onFocus={() => setFocused(s.id)}
            onBlur={() => setFocused(null)}
            className="cursor-move outline-none"
          >
            {selectedStationId === s.id && (
              <circle cx={s.x} cy={s.y} r={16} fill="#ccfbf1" stroke="#0f766e" strokeWidth={2} />
            )}
            {s.interchange ? (
              <circle cx={s.x} cy={s.y} r={9} fill="#ffffff" stroke="#111827" strokeWidth={4} />
            ) : (
              <circle cx={s.x} cy={s.y} r={5.5} fill="#ffffff" stroke="#111827" strokeWidth={2} />
            )}
            {focused === s.id && (
              <circle
                cx={s.x}
                cy={s.y}
                r={14}
                fill="none"
                stroke="#0f766e"
                strokeWidth={3}
                strokeDasharray="3 2"
              />
            )}
            <text
              x={s.x + 10}
              y={s.y - 10}
              fontSize={12}
              fill="#111827"
              fontWeight={s.interchange ? 700 : 400}
              transform={`rotate(-30 ${s.x + 10} ${s.y - 10})`}
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {s.name}
            </text>
            {(() => {
              const st = scenario.stations.find((x) => x.id === s.id);
              const icons = st ? accessFacilities(st.accessibility) : [];
              return icons.map((k, i) => <AccessIcon key={k} kind={k} x={s.x + 8 + i * 12} y={s.y + 6} />);
            })()}
          </g>
        ))}
        <g transform={`translate(10, ${h - 40})`}>
          {layout.lines.map((l, i) => (
            <g key={l.id} transform={`translate(${i * 170}, 0)`}>
              <line x1={0} y1={8} x2={24} y2={8} stroke={l.color} strokeWidth={8} strokeLinecap="round" />
              <text x={32} y={12} fontSize={11} fill="#111827">
                {l.shortName} {l.name}
              </text>
            </g>
          ))}
          <text x={0} y={32} fontSize={10} fill="#334155">
            {project.fictional ? 'FICTIONAL demonstration network. ' : ''}Schematic, not to scale. Generated
            by MobSimGame.
          </text>
        </g>
      </svg>
      <Section title="Text view" id="schematic-text">
        {textView.map((l) => (
          <div key={l.lineId} className="mb-3">
            <h3 className="text-sm font-semibold">
              <span aria-hidden className="me-1 inline-block h-2 w-4" style={{ background: l.color }} />
              {l.shortName ? `${l.shortName} ` : ''}
              {l.name}
              {l.ring ? ' (ring)' : ''}
            </h3>
            <ol className="ms-5 list-decimal text-sm">
              {l.stops.map((st) => (
                <li key={st.stationId}>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => select({ kind: 'station', id: st.stationId })}
                  >
                    {st.name}
                  </button>
                  {st.terminal && ' · terminal'}
                  {st.otherLines.length > 0 && ` · change to ${st.otherLines.join(', ')}`}
                  {st.walks.map((w) => (
                    <span key={w.stationId}>
                      {' '}
                      · walk to {w.name}
                      {w.lines.length ? ` (${w.lines.join(', ')})` : ''}
                      {w.minutes !== null &&
                        `, ${Math.max(1, Math.round(w.minutes))} min${w.calculated ? ' (estimated)' : ''}`}
                    </span>
                  ))}
                  {st.access.length > 0 && ` · ${st.access.join(', ')}`}
                </li>
              ))}
              {l.ring && <li className="list-none text-slate-600">… back to {l.stops[0]?.name}</li>}
            </ol>
          </div>
        ))}
      </Section>
    </div>
  );
}
