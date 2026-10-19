/**
 * Schematic network map proof of concept: original visual system (rounded
 * stroke lines, white station discs, black-ringed interchange capsules,
 * terminal bars). Stations can be nudged with the arrow keys for manual
 * correction; offsets are saved with the scenario.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, useScenario } from '../store/projectStore';
import { computeSchematic, crossoverPoint, describeSchematic, GRID } from '../schematic/layout';
import { Button, Section } from './primitives';
import { downloadText, safeFilename } from '../store/persistence';

export function SchematicView() {
  const scenario = useScenario();
  const project = useStore((s) => s.project);
  const commit = useStore((s) => s.commitScenario);
  const svgRef = useRef<SVGSVGElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const layout = useMemo(() => computeSchematic(scenario, scenario.schematicOffsets), [scenario]);
  const description = useMemo(() => describeSchematic(layout), [layout]);

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
  const byId = new Map(layout.stations.map((s) => [s.id, s]));
  const h = layout.height + 60;
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
        <Button
          onClick={() => commit({ ...scenario, schematicOffsets: {} }, 'Schematic corrections cleared')}
          disabled={!Object.keys(scenario.schematicOffsets).length}
        >
          Reset manual corrections
        </Button>
        <span className="text-sm text-slate-700">
          Proof of concept. Focus a station (Tab) and use arrow keys to correct its position.
        </span>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-labelledby="schematic-title schematic-desc"
        viewBox={`0 0 ${layout.width} ${h}`}
        width={layout.width}
        height={h}
        className="max-w-none"
        fontFamily="system-ui, sans-serif"
      >
        <title id="schematic-title">Schematic network map of {scenario.name}</title>
        <desc id="schematic-desc">{description}</desc>
        <rect width={layout.width} height={h} fill="#ffffff" />
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
        {layout.stations.map((s) => (
          <g
            key={s.id}
            tabIndex={0}
            role="button"
            aria-label={`${s.name}${s.interchange ? ', interchange' : ''}${s.terminal ? ', terminal' : ''}. Arrow keys move it.`}
            onKeyDown={onKey(s.id)}
            onFocus={() => setFocused(s.id)}
            onBlur={() => setFocused(null)}
            className="cursor-pointer outline-none"
          >
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
      <Section title="Text alternative" id="schematic-text">
        <p className="text-sm">{description}</p>
      </Section>
    </div>
  );
}
