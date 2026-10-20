import { describe, expect, it } from 'vitest';
import { buildDemoProject } from '../test/fixtures/demoProject';
import { buildGtfs, gtfsTime } from './gtfs';
import { crc32, zip } from './zip';

const opt = {
  baseUrl: 'https://mobsim.example.org',
  timezone: 'Europe/Berlin',
  date: new Date(Date.UTC(2026, 9, 20)),
};

const rows = (content: string) =>
  content
    .trim()
    .split('\n')
    .map((l) => l.split(','));

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a readable archive with one entry per file', () => {
    const bytes = zip([
      { name: 'a.txt', content: 'hello' },
      { name: 'b.txt', content: 'world' },
    ]);
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    // End of central directory: two entries.
    const eocd = bytes.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    expect(new TextDecoder().decode(bytes.slice(30 + 5, 30 + 10))).toBe('hello');
  });
});

describe('GTFS export', () => {
  it('builds every required file with consistent ids and increasing times', () => {
    const project = buildDemoProject();
    const sc = project.scenarios[0]!;
    const { files } = buildGtfs(project, sc, opt);
    const byName = Object.fromEntries(files.map((f) => [f.name, f.content]));
    for (const n of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt'])
      expect(byName[n]).toBeTruthy();
    const routes = rows(byName['routes.txt']!).slice(1);
    expect(routes.length).toBeGreaterThan(0);
    const stopIds = new Set(
      rows(byName['stops.txt']!)
        .slice(1)
        .map((r) => r[0]),
    );
    const times = rows(byName['stop_times.txt']!).slice(1);
    expect(times.every((r) => stopIds.has(r[3]))).toBe(true);
    // Within each trip, times never decrease and sequences count up.
    const byTrip = new Map<string, string[][]>();
    for (const r of times) byTrip.set(r[0]!, [...(byTrip.get(r[0]!) ?? []), r]);
    for (const list of byTrip.values())
      for (let i = 1; i < list.length; i++) {
        expect(list[i]![1]! >= list[i - 1]![2]!).toBe(true);
        expect(Number(list[i]![4])).toBe(Number(list[i - 1]![4]) + 1);
      }
    const freq = rows(byName['frequencies.txt']!).slice(1);
    expect(freq.every((r) => Number(r[3]) > 0)).toBe(true);
    expect(rows(byName['calendar.txt']!)[1]).toContain('20261020');
  });

  it('formats times past midnight as GTFS allows', () => {
    expect(gtfsTime(25 * 3600 + 61)).toBe('25:01:01');
  });
});
