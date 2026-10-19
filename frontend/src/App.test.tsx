import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// WebGL is unavailable in jsdom; the map is covered by the Playwright smoke test.
vi.mock('./map/MapView', () => ({ default: () => <div data-testid="map">map</div> }));

import App from './App';
import { useStore } from './store/projectStore';
import { buildDemoProject } from './domain/demo';
import { loadFromLocalStorage, parseProjectText, serializeProject, STORAGE_KEY } from './store/persistence';
import { geocode } from './providers/registry';
import { parseCoordinateList } from './ui/TableView';

beforeEach(() => {
  localStorage.clear();
  act(() => useStore.getState().loadProject(buildDemoProject()));
  act(() => useStore.getState().setView('map'));
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
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull(), { timeout: 2000 });
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
    const area = screen.getByLabelText(/Coordinates, one/);
    await user.type(area, '52.5, 113.4');
    await user.click(screen.getByRole('button', { name: 'Create line' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/fix 1 problem/);
    await user.clear(area);
    await user.type(area, '0.01, 0.03{Enter}0.02, 0.03');
    await user.click(screen.getByRole('button', { name: 'Create line' }));
    expect(useStore.getState().project.scenarios[0]!.lines).toHaveLength(4);
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
      'New project',
      'Load demo',
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
    expect(screen.getByRole('menuitem', { name: 'New project' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Load demo' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /Sign in/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'New project' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('runs the chosen action and closes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New project' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(useStore.getState().project.name).toBe('Untitled project');
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
