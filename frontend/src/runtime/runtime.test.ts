import { describe, expect, it, vi } from 'vitest';
import { checkHealth, deriveStatus, startMonitor, type MonitorEnvironment } from './connectivity';
import {
  isUpdateAvailable,
  mayReloadFor,
  parseBuildInfo,
  readReloadAttempt,
  recordReloadAttempt,
  RELOAD_RETRY_WINDOW_MS,
  unsavedWorkReasons,
  type BuildInfo,
} from './version';

const build = (buildId: string): BuildInfo => ({
  version: '0.1.0',
  buildId,
  builtAt: '2026-10-20T00:00:00Z',
});
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

describe('connection status', () => {
  it('never reports connected without a healthy backend', () => {
    expect(deriveStatus({ browserOnline: true, health: 'ok', updating: false })).toBe('connected');
    expect(deriveStatus({ browserOnline: true, health: 'unreachable', updating: false })).toBe('unreachable');
    expect(deriveStatus({ browserOnline: true, health: 'degraded', updating: false })).toBe('degraded');
    expect(deriveStatus({ browserOnline: true, health: null, updating: false })).toBe('checking');
    expect(deriveStatus({ browserOnline: false, health: 'ok', updating: false })).toBe('offline');
    expect(deriveStatus({ browserOnline: true, health: 'ok', updating: true })).toBe('updating');
  });

  it('classifies health responses', async () => {
    expect(await checkHealth(() => json({ status: 'ok', database: 'ok' }))).toBe('ok');
    expect(await checkHealth(() => json({ status: 'degraded', database: 'unavailable' }))).toBe('degraded');
    expect(await checkHealth(() => json({}, 502))).toBe('unreachable');
    expect(await checkHealth(() => Promise.reject(new TypeError('Failed to fetch')))).toBe('unreachable');
    // A proxy answering with an HTML error page is not a healthy backend.
    expect(await checkHealth(() => Promise.resolve(new Response('<html>', { status: 200 })))).toBe(
      'unreachable',
    );
  });

  it('times out a hanging health check', async () => {
    vi.useFakeTimers();
    const hanging: typeof fetch = (_u, init) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    const p = checkHealth(hanging, '', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe('unreachable');
    vi.useRealTimers();
  });

  it('checks at start, when back online, when the tab is shown again and periodically', () => {
    const listeners: Record<string, () => void> = {};
    let tick: () => void = () => undefined;
    let online = true;
    let visible = true;
    const env: MonitorEnvironment = {
      isOnline: () => online,
      isVisible: () => visible,
      addListener: (_t, event, fn) => {
        listeners[event] = fn;
        return () => delete listeners[event];
      },
      setInterval: (fn) => {
        tick = fn;
        return () => undefined;
      },
    };
    const check = vi.fn();
    const offline = vi.fn();
    const stop = startMonitor(env, check, offline);
    expect(check).toHaveBeenCalledTimes(1);
    tick();
    expect(check).toHaveBeenCalledTimes(2);
    visible = false;
    tick();
    expect(check).toHaveBeenCalledTimes(2); // hidden tabs do not poll
    visible = true;
    listeners.visibilitychange!();
    expect(check).toHaveBeenCalledTimes(3);
    online = false;
    listeners.offline!();
    tick();
    expect(offline).toHaveBeenCalledTimes(2);
    online = true;
    listeners.online!();
    expect(check).toHaveBeenCalledTimes(4);
    stop();
    expect(Object.keys(listeners)).toHaveLength(0);
  });
});

describe('version updates', () => {
  it('detects a newly deployed build', () => {
    expect(isUpdateAvailable(build('a'), build('b'))).toBe(true);
    expect(isUpdateAvailable(build('a'), build('a'))).toBe(false);
    expect(isUpdateAvailable(build('a'), null)).toBe(false);
    expect(parseBuildInfo({ version: 1 })).toBeNull();
    expect(parseBuildInfo(build('x'))).toEqual(build('x'));
  });

  it('prevents an infinite reload loop', () => {
    const now = 1_000_000;
    expect(mayReloadFor(null, 'b', now)).toBe(true);
    // Already reloaded for build b and still running the old one: do not reload again.
    expect(mayReloadFor({ buildId: 'b', at: now - 1000 }, 'b', now)).toBe(false);
    // A different new build may be tried, and the same one again after the window.
    expect(mayReloadFor({ buildId: 'b', at: now - 1000 }, 'c', now)).toBe(true);
    expect(mayReloadFor({ buildId: 'b', at: now - RELOAD_RETRY_WINDOW_MS - 1 }, 'b', now)).toBe(true);
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    recordReloadAttempt(storage, 'b', now);
    expect(readReloadAttempt(storage)).toEqual({ buildId: 'b', at: now });
  });

  it('refuses to update silently over unsaved work', () => {
    expect(unsavedWorkReasons({ drawing: false, autosaveFailed: false, editingField: false })).toEqual([]);
    const reasons = unsavedWorkReasons({ drawing: true, autosaveFailed: true, editingField: true });
    expect(reasons).toHaveLength(3);
    expect(reasons.join(' ')).toMatch(/could not be saved/);
  });
});
