import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// WebGL is unavailable in jsdom; the map is covered by the Playwright smoke test.
vi.mock('./map/MapView', () => ({ default: () => <div data-testid="map">map</div> }));

import App from './App';
import { blankProject, useStore } from './store/projectStore';
import { notify, useNotifications } from './store/notifications';
import { buildDemoProject } from './test/fixtures/demoProject';
import { LIBRARY_KEY, loadFromLocalStorage, parseProjectText, serializeProject } from './store/persistence';
import { geocode } from './providers/registry';
import { parseCoordinateList } from './ui/TableView';

// These tests render and drive the whole application; shared CI runners are several
// times slower than a workstation, so they get more than Vitest's 5 s default.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  localStorage.clear();
  act(() => useStore.getState().loadProject(buildDemoProject()));
  act(() => useStore.getState().setView('map'));
  act(() => {
    useStore.getState().closeProjectGate();
    useStore.getState().setTool('select');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('application shell', () => {
  it('renders the fictional demo with its warnings and attribution link', async () => {
    render(<App />);
    expect(screen.getByText(/Fictional demonstration project/)).toBeInTheDocument();
    expect(screen.getAllByText(/FICTIONAL DEMO/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Limitations, data & licences/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Lines' })).toBeInTheDocument();
    expect(await screen.findByTestId('map')).toBeInTheDocument();
  });

  it('is keyboard navigable: skip link first, lists reachable, Enter selects', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(screen.getByText('Skip to main content')).toHaveFocus();
    const lines = within(screen.getByRole('list', { name: 'Lines' })).getAllByRole('button');
    lines[0]!.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Line' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Red Line (fictional)');
  });

  it('edits commit on blur and can be undone with Ctrl+Z and redone with Ctrl+Shift+Z', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole('list', { name: 'Lines' })).getAllByRole('button')[0]!);
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Renamed line{Enter}');
    expect(within(screen.getByRole('list', { name: 'Lines' })).getByText('Renamed line')).toBeInTheDocument();
    await user.click(document.body);
    await user.keyboard('{Control>}z{/Control}');
    expect(
      within(screen.getByRole('list', { name: 'Lines' })).getByText('Red Line (fictional)'),
    ).toBeInTheDocument();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(within(screen.getByRole('list', { name: 'Lines' })).getByText('Renamed line')).toBeInTheDocument();
  });

  it('duplicates a scenario', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    const select = screen.getByLabelText('Active scenario') as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.selectedOptions[0]!.textContent).toMatch(/\(copy\)/);
  });

  it('autosaves the project to local storage', async () => {
    render(<App />);
    await waitFor(() => expect(localStorage.getItem(LIBRARY_KEY)).not.toBeNull(), { timeout: 2000 });
    expect(loadFromLocalStorage()!.name).toBe('Fictional demo city');
  });

  it('reports an invalid project file instead of loading it', async () => {
    const user = userEvent.setup();
    render(<App />);
    const file = new File(['{"not":"a project"}'], 'bad.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Open project file'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not open project: (?!.*not a function)/,
    );
    expect(useStore.getState().project.name).toBe('Fictional demo city');
  });

  it('loads a valid project file', async () => {
    const user = userEvent.setup();
    render(<App />);
    const p = { ...buildDemoProject(), name: 'From file' };
    await user.upload(
      screen.getByLabelText('Open project file'),
      new File([serializeProject(p)], 'p.json', { type: 'application/json' }),
    );
    await waitFor(() => expect(useStore.getState().project.name).toBe('From file'));
  });

  it('shows an error summary for invalid typed coordinates and creates a line from valid ones', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Table/ }));
    await user.selectOptions(screen.getByLabelText('Mode of the new track or line'), 'bus');
    const area = screen.getByLabelText(/Coordinates, one/);
    await user.type(area, '52.5, 113.4');
    await user.click(screen.getByRole('button', { name: 'Create line' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/fix 1 problem/);
    await user.clear(area);
    await user.type(area, '0.01, 0.03{Enter}0.02, 0.03');
    await user.click(screen.getByRole('button', { name: 'Create line' }));
    expect(useStore.getState().project.scenarios[0]!.lines).toHaveLength(4);
  });

  it('creates track, a station on it and a service without the map', { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Table/ }));
    await user.selectOptions(screen.getByLabelText('Mode of the new track or line'), 'tram');
    const before = useStore.getState().project.scenarios[0]!.trackNetwork.tracks.length;
    await user.type(screen.getByLabelText(/Coordinates, one/), '0.10, 0.10{Enter}0.12, 0.10');
    await user.click(screen.getByRole('button', { name: 'Create track' }));
    expect(useStore.getState().project.scenarios[0]!.trackNetwork.tracks).toHaveLength(before + 2);
    for (const at of ['0.10, 0.10', '0.12, 0.10']) {
      await user.clear(screen.getByLabelText(/Position “longitude, latitude”/));
      await user.type(screen.getByLabelText(/Position “longitude, latitude”/), at);
      await user.click(screen.getByRole('button', { name: 'Add station at this position' }));
    }
    const stations = useStore.getState().project.scenarios[0]!.stations.slice(-2);
    expect(stations.every((s) => s.trackRefs.length === 2)).toBe(true);
    act(() => useStore.getState().setNewLineMode('tram'));
    await user.click(screen.getByRole('button', { name: 'New service' }));
    for (const st of stations) await user.selectOptions(screen.getByLabelText('Add a station'), st.id);
    await user.click(screen.getByRole('button', { name: 'Create service' }));
    const line = useStore.getState().project.scenarios[0]!.lines.at(-1)!;
    expect(line.alignment.kind === 'track' && line.alignment.status).toBe('routed');
  });

  it('opens the data sources dialog listing provider states', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Data & licences' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByText(/Open Database Licence/)).toBeInTheDocument();
    expect(within(dialog).getByText('Traffic')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Demonstration data/).length).toBeGreaterThan(0);
  });
});

describe('File menu', () => {
  it('keeps import and export behind a dropdown until opened', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('menuitem', { name: /Export GeoJSON/ })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'File' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'File' });
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent);
    expect(labels).toEqual([
      'New project…',
      'Switch project…this browser',
      'Open real network…OSM',
      'Open project….json',
      'Save project.json',
      'Import GeoJSON…',
      'Export GeoJSON',
      'Export coordinates.csv',
      'Save to server and share…',
      'Print report',
      'Sign in…server',
    ]);
  });

  it('asks for the server login before sharing', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: /Save to server and share/ }));
    expect(screen.getByRole('heading', { name: 'Sign in to save on the server' })).toBeInTheDocument();
    // Nothing was sent before signing in.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    vi.unstubAllGlobals();
  });

  it('supports keyboard navigation and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = screen.getByRole('button', { name: 'File' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'New project…' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Switch project/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /Sign in/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'New project…' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('runs the chosen action and closes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New project…' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'New project' })).toBeInTheDocument();
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('persistence', () => {
  it('round-trips a project through JSON', () => {
    const p = buildDemoProject();
    const parsed = parseProjectText(serializeProject(p));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project).toEqual(p);
  });

  it('rejects malformed JSON with a message', () => {
    const parsed = parseProjectText('{oops');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/not valid JSON/);
  });
});

describe('provider unavailability', () => {
  it('falls back to the offline geocoder when the backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await geocode('0.02, 0.035');
    expect(res.capability.state).toBe('using_fallback');
    expect(res.data[0]!.position).toEqual([0.035, 0.02]);
  });

  it('maps HTTP 429 to the rate-limited state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    const res = await geocode('somewhere');
    expect(res.capability.message).toMatch(/Rate limit/);
  });
});

describe('coordinate list parsing', () => {
  it('parses [lng, lat] rows and rejects out-of-range values', () => {
    expect(parseCoordinateList('1, 2\n3 4').coords).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(parseCoordinateList('10, 95\n1, 1').errors[0]).toMatch(/longitude, latitude/);
    expect(parseCoordinateList('1, 2').errors[0]).toMatch(/at least two/);
  });
});

describe('no secrets in browser code', () => {
  it('only reads whitelisted public VITE_ variables', () => {
    const allowed = new Set([
      'VITE_API_BASE_URL',
      'VITE_EXTRA_BASEMAPS',
      'VITE_TERRAIN_TILES_URL',
      'VITE_LOG_LEVEL',
      'VITE_SOURCE_URL',
    ]);
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.tsx')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g))
            used.add(m[1]!);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    for (const v of used) expect(allowed.has(v)).toBe(true);
  });
});

describe('Start a network card', () => {
  it('closes when drawing starts, keeps drawing, and returns after Escape', async () => {
    const user = userEvent.setup();
    act(() => useStore.getState().loadProject(blankProject()));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Start a network' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Draw track or a line' }));
    expect(screen.queryByRole('heading', { name: 'Start a network' })).not.toBeInTheDocument();
    expect(useStore.getState().tool).toBe('draw_line');
    await user.keyboard('{Escape}');
    expect(useStore.getState().tool).toBe('select');
    expect(screen.getAllByRole('heading', { name: 'Start a network' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close start a network' }));
    expect(screen.queryByRole('heading', { name: 'Start a network' })).not.toBeInTheDocument();
  });

  it('asks for a project first when none is active, then starts drawing', async () => {
    const user = userEvent.setup();
    act(() => {
      useStore.getState().loadProject(blankProject());
      useStore.setState({ projectActive: false });
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Draw track or a line' }));
    expect(screen.getByRole('heading', { name: 'Choose a project for your line' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name of the new project'), 'Harbour tram');
    await user.click(screen.getByRole('button', { name: 'Create and start drawing' }));
    expect(useStore.getState().project.name).toBe('Harbour tram');
    expect(useStore.getState().tool).toBe('draw_line');
    expect(screen.queryByRole('heading', { name: 'Choose a project for your line' })).not.toBeInTheDocument();
  });
});

describe('notification menu', () => {
  it('records toasts, groups repeats and navigates to the related line', async () => {
    const user = userEvent.setup();
    useNotifications.getState().clearAll();
    render(<App />);
    const line = useStore.getState().project.scenarios[0]!.lines[0]!;
    act(() => {
      notify({ severity: 'warning', title: 'Not routed', target: { lineId: line.id } });
      notify({ severity: 'warning', title: 'Not routed', target: { lineId: line.id } });
    });
    await user.click(screen.getByRole('button', { name: /Notifications, 1 unread/ }));
    const list = screen.getByRole('list', { name: 'Notification list' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/2×/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Warning: Not routed.*Show on map/ }));
    expect(useStore.getState().selection).toEqual({ kind: 'line', id: line.id });
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('vehicles in the line inspector', () => {
  it('offers only vehicles of the line’s mode and shows the fleet needed', async () => {
    const user = userEvent.setup();
    render(<App />);
    const lines = screen.getByRole('list', { name: 'Lines' });
    await user.click(within(lines).getByRole('button', { name: /Red Line/ }));
    const select = screen.getByLabelText('Vehicle type') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.text);
    expect(labels.some((l) => /metro/i.test(l))).toBe(true);
    expect(labels.some((l) => /bus|tram/i.test(l))).toBe(false);
    expect(screen.getByTestId('fleet-summary')).toHaveTextContent(/Needed: \d+ at peak/);
    const assigned = screen.getByLabelText(/Vehicles assigned/);
    await user.clear(assigned);
    await user.type(assigned, '1{Enter}');
    expect(screen.getByTestId('fleet-summary')).toHaveTextContent(/short of the peak headway/);
  });
});

describe('traffic signals by hand', () => {
  it('adds a signal at typed coordinates and edits its type and controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText(/^Traffic signals \(/));
    await user.type(screen.getByLabelText(/Add a signal at/), '0.03, 0.02');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    const sig = useStore.getState().project.scenarios[0]!.trafficSignals.at(-1)!;
    expect(sig).toMatchObject({ position: [0.03, 0.02], source: 'manual', confirmation: 'confirmed' });
    expect(useStore.getState().selection).toEqual({ kind: 'signal', id: sig.id });
    await user.selectOptions(screen.getByLabelText('Signal type'), 'tram_crossing');
    await user.click(screen.getByRole('checkbox', { name: 'trams' }));
    const after = useStore.getState().project.scenarios[0]!.trafficSignals.at(-1)!;
    expect(after).toMatchObject({ kind: 'tram_crossing', controls: ['trams'] });
  });
});

describe('regions', () => {
  it(
    'creates a region from typed corners, records a sourced value and locks it',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByText(/^Regions \(/));
      await user.click(screen.getByText('Create a region from typed corners'));
      await user.type(
        screen.getByLabelText(/Corners, one/),
        '0.00, 0.00{Enter}0.01, 0.00{Enter}0.01, 0.01{Enter}0.00, 0.01',
      );
      await user.click(screen.getByRole('button', { name: 'Create region' }));
      const region = useStore.getState().project.scenarios[0]!.regions.at(-1)!;
      expect(useStore.getState().selection).toEqual({ kind: 'region', id: region.id });
      expect(screen.getByText(/calculated, projected/)).toHaveTextContent(/1\.2\d\d km²/);
      const pop = screen.getByLabelText(/^Total population/);
      await user.type(pop, '4200{Enter}');
      expect(screen.getByText(/Population density from population and area/)).toBeInTheDocument();
      expect(
        useStore.getState().project.scenarios[0]!.regions.at(-1)!.attributes.totalPopulation,
      ).toMatchObject({
        value: 4200,
        unit: 'persons',
        status: 'manual',
      });
      await user.click(screen.getByLabelText(/^Lock/));
      expect(screen.getByRole('button', { name: 'Delete region' })).toBeDisabled();
    },
  );

  it('creates a region from a looked-up boundary and offers drawing when there is none', async () => {
    const user = userEvent.setup();
    const prov = {
      provider: 'Nominatim',
      dataset: 'OpenStreetMap',
      sourceUrl: null,
      coverage: 'Global',
      datasetDate: null,
      spatialResolution: null,
      cacheExpiresAt: null,
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors (ODbL)',
      retrievedAt: '2026-10-20T12:00:00Z',
      status: 'observed',
      limitations: [],
      confidence: 'medium',
    };
    const ok = { state: 'available', message: '', checkedAt: 'x' };
    const json = (data: unknown, capability = ok) =>
      new Response(JSON.stringify({ data, provenance: prov, capability }), { status: 200 });
    const square = [
      [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0],
      ],
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/geocode/boundary/relation/'))
        return json({
          label: 'Mitte',
          osmType: 'relation',
          osmId: 1,
          geometry: { type: 'Polygon', coordinates: square },
        });
      if (url.includes('/geocode?'))
        return json([
          {
            label: 'Mitte, Berlin',
            position: [0, 0],
            bbox: null,
            kind: 'suburb',
            osmType: 'relation',
            osmId: 1,
            hierarchy: ['Berlin'],
            boundaryAvailable: true,
          },
          {
            label: 'Brunnen, Berlin',
            position: [0, 0],
            bbox: null,
            kind: 'neighbourhood',
            osmType: 'node',
            osmId: 2,
            hierarchy: ['Berlin'],
            boundaryAvailable: false,
          },
        ]);
      return new Response('{}', { status: 404 });
    });
    render(<App />);
    await user.click(screen.getByText(/^Regions \(/));
    await user.type(screen.getByLabelText('City, district or neighbourhood'), 'mitte{Enter}');
    const list = await screen.findByRole('list', { name: 'Places found' });
    expect(within(list).getAllByText(/In Berlin/)).toHaveLength(2);
    const before = useStore.getState().project.scenarios[0]!.regions.length;
    await user.click(within(list).getByRole('button', { name: 'Create region from boundary' }));
    await screen.findByText(/Statistics are empty until you enter them/);
    const regions = useStore.getState().project.scenarios[0]!.regions;
    expect(regions).toHaveLength(before + 1);
    expect(regions.at(-1)!).toMatchObject({ type: 'neighbourhood', attributes: {} });
    expect(regions.at(-1)!.source.status).toBe('imported');
    await user.click(within(list).getByRole('button', { name: 'No boundary: draw by hand' }));
    expect(screen.getByText(/No boundary is available for Brunnen/)).toBeInTheDocument();
    expect(useStore.getState().project.scenarios[0]!.regions).toHaveLength(before + 1);
    await user.click(screen.getByRole('button', { name: 'Draw the region by hand' }));
  });
});

describe('infrastructure compatibility', () => {
  it('edits which track a mode may use and resets it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('Infrastructure compatibility'));
    const own = screen.getByRole('checkbox', { name: /Tram \/ streetcar may use tram track/ });
    expect(own).toBeChecked();
    expect(own).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Tram \/ streetcar may use railway track/ }));
    expect(useStore.getState().project.scenarios[0]!.trackNetwork.serviceCompatibility.tram).toContain(
      'railway',
    );
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(useStore.getState().project.scenarios[0]!.trackNetwork.serviceCompatibility.tram).toBeUndefined();
  });
});

describe('validation panel', () => {
  it('labels the categories, filters them and links findings to their objects', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = screen.getByRole('list', { name: 'Findings by category' });
    for (const name of [/Errors: \d+/, /Warnings: \d+/, /Recommendations: \d+/, /Information: \d+/])
      expect(within(panel).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/What do the categories mean/).length).toBeGreaterThan(0);
    const findings = screen.getAllByRole('list', { name: 'Findings' })[0]!;
    const before = within(findings).getAllByRole('listitem').length;
    const info = within(panel).getByRole('button', { name: /Information: / });
    await user.click(info);
    expect(info).toHaveAttribute('aria-pressed', 'false');
    const after = within(screen.getAllByRole('list', { name: 'Findings' })[0]!).queryAllByRole(
      'listitem',
    ).length;
    expect(after).toBeLessThan(before);
    await user.selectOptions(screen.getAllByLabelText('Sort findings by')[0]!, 'station');
    const show = within(screen.getAllByRole('list', { name: 'Findings' })[0]!).getAllByRole('button', {
      name: /^Show on map/,
    })[0]!;
    await user.click(show);
    expect(useStore.getState().focusedFindingId).not.toBeNull();
    expect(useStore.getState().selection).not.toBeNull();
  });
});

describe('station naming in the inspector', () => {
  it('always leaves the loading state and lists suggestions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole('list', { name: 'Stations' })).getAllByRole('button')[0]!);
    await user.click(screen.getByRole('button', { name: 'Suggest names from nearby features' }));
    await waitFor(() => expect(screen.getByTestId('name-lookup-status')).not.toHaveTextContent('Looking up'));
    expect(screen.getByRole('list', { name: 'Name suggestions' })).toBeInTheDocument();
  });
});
