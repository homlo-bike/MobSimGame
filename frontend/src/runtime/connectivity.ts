/**
 * Connection monitoring: browser network state plus backend reachability.
 *
 * The editor keeps working without the server (projects autosave in this
 * browser), but the status must never look "connected" when the API does not
 * answer. Checks run at start, when the browser goes online, when the tab
 * becomes visible again and periodically while the tab is visible.
 */
export type ConnectionStatus = 'checking' | 'connected' | 'degraded' | 'unreachable' | 'offline' | 'updating';

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  checking: 'Checking connection…',
  connected: 'Online · connected to the server',
  degraded: 'Server problem (database unavailable)',
  unreachable: 'Cannot reach the server',
  offline: 'Offline',
  updating: 'Updating to a new version…',
};

export const HEALTH_TIMEOUT_MS = 5000;
export const HEALTH_INTERVAL_MS = 30000;

export type HealthResult = 'ok' | 'degraded' | 'unreachable';

/** Pure: the status shown for a combination of browser and server state. */
export function deriveStatus(input: {
  browserOnline: boolean;
  health: HealthResult | null;
  updating: boolean;
}): ConnectionStatus {
  if (input.updating) return 'updating';
  if (!input.browserOnline) return 'offline';
  if (input.health === null) return 'checking';
  if (input.health === 'ok') return 'connected';
  return input.health === 'degraded' ? 'degraded' : 'unreachable';
}

/** One health check of the backend; never throws. */
export async function checkHealth(
  fetchImpl: typeof fetch = fetch,
  base = '',
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<HealthResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/health`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return 'unreachable';
    const body = (await res.json()) as { status?: string; database?: string };
    if (body.status === 'ok') return 'ok';
    return body.status === 'degraded' ? 'degraded' : 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

export interface MonitorEnvironment {
  isOnline: () => boolean;
  isVisible: () => boolean;
  addListener: (target: 'window' | 'document', event: string, fn: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => () => void;
}

export function browserEnvironment(): MonitorEnvironment {
  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    addListener: (target, event, fn) => {
      const t = target === 'window' ? window : document;
      t.addEventListener(event, fn);
      return () => t.removeEventListener(event, fn);
    },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
  };
}

/**
 * Run `check` on start, on `online`, when the tab becomes visible and every
 * `intervalMs` while visible; report `offline` at once when the browser goes
 * offline. Returns a stop function.
 */
export function startMonitor(
  env: MonitorEnvironment,
  check: () => void | Promise<void>,
  onOffline: () => void,
  intervalMs = HEALTH_INTERVAL_MS,
): () => void {
  const run = () => {
    if (!env.isOnline()) onOffline();
    else void check();
  };
  const stops = [
    env.addListener('window', 'online', run),
    env.addListener('window', 'offline', onOffline),
    env.addListener('document', 'visibilitychange', () => {
      if (env.isVisible()) run();
    }),
    env.setInterval(() => {
      if (env.isVisible()) run();
    }, intervalMs),
  ];
  run();
  return () => stops.forEach((s) => s());
}
