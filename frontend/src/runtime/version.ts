/**
 * Application-version detection.
 *
 * Every build carries a build id (injected by vite.config.ts) and publishes the
 * same id in /version.json. nginx serves /version.json and index.html with
 * Cache-Control: no-cache, so fetching it tells us what is deployed now.
 * Hashed assets under /assets/ are immutable and need no invalidation.
 */
export interface BuildInfo {
  version: string;
  buildId: string;
  builtAt: string;
}

export const RUNNING_BUILD: BuildInfo = {
  version: __APP_VERSION__,
  buildId: __BUILD_ID__,
  builtAt: __BUILD_TIME__,
};

export function parseBuildInfo(data: unknown): BuildInfo | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  return typeof d.version === 'string' && typeof d.buildId === 'string' && typeof d.builtAt === 'string'
    ? { version: d.version, buildId: d.buildId, builtAt: d.builtAt }
    : null;
}

export function isUpdateAvailable(running: BuildInfo, deployed: BuildInfo | null): boolean {
  return !!deployed && deployed.buildId !== running.buildId;
}

/** Fetch the deployed build; null when unreachable or invalid (never throws). */
export async function fetchDeployedBuild(fetchImpl: typeof fetch = fetch): Promise<BuildInfo | null> {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseBuildInfo(await res.json());
  } catch {
    return null;
  }
}

/** A reload attempt for a deployed build, remembered for this tab to prevent reload loops. */
export interface ReloadAttempt {
  buildId: string;
  at: number;
}

export const RELOAD_GUARD_KEY = 'mobsimgame.updateAttempt.v1';
/** Do not retry an automatic reload for the same build within this window. */
export const RELOAD_RETRY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether reloading to `deployedBuildId` may still help. False when this tab
 * already reloaded for that build recently and still runs the old one (e.g. a
 * proxy or browser cache keeps serving the old page): reloading again would loop.
 */
export function mayReloadFor(attempt: ReloadAttempt | null, deployedBuildId: string, now: number): boolean {
  if (!attempt || attempt.buildId !== deployedBuildId) return true;
  return now - attempt.at > RELOAD_RETRY_WINDOW_MS;
}

export function readReloadAttempt(storage: Pick<Storage, 'getItem'> | null): ReloadAttempt | null {
  try {
    const raw = storage?.getItem(RELOAD_GUARD_KEY);
    return raw ? (JSON.parse(raw) as ReloadAttempt) : null;
  } catch {
    return null;
  }
}

export function recordReloadAttempt(storage: Pick<Storage, 'setItem'> | null, buildId: string, now: number) {
  try {
    storage?.setItem(RELOAD_GUARD_KEY, JSON.stringify({ buildId, at: now }));
  } catch {
    /* without session storage the guard lives only until reload; mayReloadFor then allows one more try */
  }
}

/** Reasons the user could lose work by reloading now; empty when it is safe. */
export function unsavedWorkReasons(state: {
  drawing: boolean;
  autosaveFailed: boolean;
  editingField: boolean;
}): string[] {
  const reasons: string[] = [];
  if (state.drawing) reasons.push('A line is being drawn and is not finished.');
  if (state.autosaveFailed)
    reasons.push('The project could not be saved in this browser, so reloading would lose recent changes.');
  if (state.editingField) reasons.push('A field is being edited and not yet confirmed.');
  return reasons;
}

/**
 * MobSimGame does not use a service worker. Remove any registration and Cache
 * Storage left on this origin (for example by an earlier version or another app
 * served on the same host and port), which could otherwise keep serving an old
 * page while the server is down.
 */
export async function removeStaleServiceWorkers(): Promise<{ workers: number; caches: number }> {
  let workers = 0;
  let removedCaches = 0;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    for (const r of regs) if (await r.unregister()) workers++;
  } catch {
    /* not available (insecure context or unsupported) */
  }
  try {
    if (typeof caches !== 'undefined') {
      for (const key of await caches.keys()) if (await caches.delete(key)) removedCaches++;
    }
  } catch {
    /* Cache Storage unavailable */
  }
  return { workers, caches: removedCaches };
}
