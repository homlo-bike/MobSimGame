import { describe, expect, it } from 'vitest';
import { railLine, xy } from '../test/fixtures/tracks';
import { createLine, emptyScenario } from '../domain/network';
import { buildSumo } from './sumo';

describe('SUMO export', () => {
  it('exports track as edges, platforms as stops and services as flows', () => {
    const { s, line } = railLine([xy(0, 0), xy(2000, 0)], 'tram', [xy(0, 0), xy(1000, 0), xy(2000, 0)]);
    const out = buildSumo(s, 'Test');
    const file = (n: string) => out.files.find((f) => f.name === n)!.content;
    const edges = file('network.edg.xml');
    expect(edges).toContain('allow="tram"');
    expect((edges.match(/<edge /g) ?? []).length).toBeGreaterThan(0);
    const nodes = file('network.nod.xml');
    // Every edge endpoint is a declared node.
    const nodeIds = new Set([...nodes.matchAll(/node id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of edges.matchAll(/from="([^"]+)" to="([^"]+)"/g)) {
      expect(nodeIds.has(m[1])).toBe(true);
      expect(nodeIds.has(m[2])).toBe(true);
    }
    const stops = file('stops.add.xml');
    expect((stops.match(/<trainStop /g) ?? []).length).toBeGreaterThanOrEqual(3);
    const routes = file('routes.rou.xml');
    expect(routes).toContain(`<flow id="${line.id}_out"`);
    expect(routes).toContain(`<flow id="${line.id}_back"`);
    expect(routes).toMatch(/<vType id="vt_[^"]+" vClass="tram"/);
    // Every stop a flow calls at is declared and on an edge of the route.
    const declared = new Set(
      [...stops.matchAll(/trainStop id="([^"]+)" lane="([^"]+)_0"/g)].map((m) => m[1]),
    );
    for (const m of routes.matchAll(/busStop="([^"]+)"/g)) expect(declared.has(m[1])).toBe(true);
    expect(out.skipped).toHaveLength(0);
    // XML comments must not contain "--" (netconvert refuses the file).
    const named = buildSumo(s, 'A -- B');
    for (const f of named.files.filter((x) => x.name.endsWith('.xml')))
      for (const m of f.content.matchAll(/<!--([\s\S]*?)-->/g)) expect(m[1]).not.toContain('--');
  });

  it('leaves street lines to the GTFS export and says so', () => {
    const c = createLine(emptyScenario(), { coordinates: [xy(0, 0), xy(500, 0)], mode: 'bus' });
    const out = buildSumo(c.scenario, 'Bus');
    expect(out.skipped[0]?.reason).toMatch(/GTFS/);
    expect(out.files.find((f) => f.name === 'README.txt')!.content).toMatch(/--proj.utm/);
  });
});
