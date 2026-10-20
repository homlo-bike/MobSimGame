/**
 * Wires the connection monitor and the version check to the stores and the
 * notification centre. Browser glue only; the decisions live in connectivity.ts
 * and version.ts, which are unit-tested.
 */
import { useConnection } from '../store/connection';
import { notify } from '../store/notifications';
import { useStore } from '../store/projectStore';
import { saveToLocalStorage } from '../store/persistence';
import { API_BASE } from '../providers/backend';
import { createLogger } from '../util/logger';
import {
  browserEnvironment,
  checkHealth,
  deriveStatus,
  startMonitor,
  type HealthResult,
} from './connectivity';
import {
  fetchDeployedBuild,
  isUpdateAvailable,
  mayReloadFor,
  readReloadAttempt,
  recordReloadAttempt,
  removeStaleServiceWorkers,
  RUNNING_BUILD,
  unsavedWorkReasons,
} from './version';

const log = createLogger('status');

const session = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

function apply(patch: { browserOnline?: boolean; health?: HealthResult | null; updating?: boolean }) {
  const c = useConnection.getState();
  const next = { browserOnline: c.browserOnline, health: c.health, updating: c.updating, ...patch };
  const status = deriveStatus(next);
  const before = c.status;
  c.set({ ...patch, status, lastCheckedAt: new Date().toISOString() });
  if (status === before) return;
  log.info('connection status changed', { from: before, to: status });
  // Only transitions are recorded, never each periodic check.
  if (status === 'unreachable' || status === 'degraded')
    notify({
      severity: 'warning',
      kind: 'connection',
      title:
        status === 'degraded' ? 'Server problem: database unavailable' : 'Cannot reach the MobSimGame server',
      message:
        'Editing continues and is saved in this browser. Sharing, real networks and routing are unavailable until the server answers.',
    });
  else if (status === 'offline')
    notify({
      severity: 'warning',
      kind: 'connection',
      title: 'You are offline',
      message: 'Editing continues and is saved in this browser.',
    });
  else if (status === 'connected' && before !== 'checking')
    notify({ severity: 'success', kind: 'connection', title: 'Connection to the server restored' });
}

async function checkVersion() {
  const deployed = await fetchDeployedBuild();
  if (!deployed) return;
  const available = isUpdateAvailable(RUNNING_BUILD, deployed);
  const c = useConnection.getState();
  if (!available) {
    c.set({ deployed, updateAvailable: false, updateBlocked: null });
    return;
  }
  const attempt = readReloadAttempt(session());
  const blocked = mayReloadFor(attempt, deployed.buildId, Date.now())
    ? null
    : 'The browser kept loading the previous version after reloading. Reload without cache (Ctrl+Shift+R, or Cmd+Shift+R on macOS); if that does not help, a proxy or cache in front of the server serves an old page.';
  if (!c.updateAvailable || c.deployed?.buildId !== deployed.buildId) {
    log.info('new application version available', {
      running: RUNNING_BUILD.buildId,
      deployed: deployed.buildId,
    });
    notify({
      severity: 'info',
      kind: 'update',
      title: `A new version of MobSimGame is available (built ${deployed.builtAt.slice(0, 16).replace('T', ' ')} UTC)`,
      toast: false,
    });
  }
  c.set({ deployed, updateAvailable: true, updateBlocked: blocked });
}

async function checkAll() {
  const health = await checkHealth(fetch, API_BASE);
  apply({ browserOnline: true, health });
  // The version file is served by the web server, independent of the API.
  await checkVersion();
}

/** Start monitoring; returns a stop function. */
export function startAppStatus(): () => void {
  // A successful update: this tab reloaded for exactly the build it now runs.
  const attempt = readReloadAttempt(session());
  if (attempt && attempt.buildId === RUNNING_BUILD.buildId) {
    try {
      session()?.removeItem('mobsimgame.updateAttempt.v1');
    } catch {
      /* ignore */
    }
    notify({
      severity: 'success',
      kind: 'update',
      title: `Updated to the latest version (${RUNNING_BUILD.version})`,
    });
  }
  void removeStaleServiceWorkers().then((r) => {
    if (r.workers || r.caches) log.info('removed stale service workers and caches', r);
  });
  return startMonitor(browserEnvironment(), checkAll, () => apply({ browserOnline: false }));
}

/** Reasons not to reload right now (checked before an update). */
export function currentUnsavedWorkReasons(autosaveFailed: boolean): string[] {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const editingField =
    !!active && ['INPUT', 'TEXTAREA'].includes(active.tagName) && !!(active as HTMLInputElement).value;
  return unsavedWorkReasons({
    drawing: useStore.getState().tool === 'draw_line',
    autosaveFailed,
    editingField,
  });
}

/**
 * Reload into the deployed version. The project is saved in this browser first;
 * if that fails the update is refused (the caller offers a file download).
 */
export async function applyUpdate(): Promise<{ ok: boolean; error?: string }> {
  const c = useConnection.getState();
  if (!c.deployed) return { ok: false, error: 'No newer version is known' };
  const saved = saveToLocalStorage(useStore.getState().project);
  if (!saved.ok)
    return { ok: false, error: `The project could not be saved in this browser (${saved.error})` };
  apply({ updating: true });
  recordReloadAttempt(session(), c.deployed.buildId, Date.now());
  await removeStaleServiceWorkers();
  log.info('reloading into the new version', { to: c.deployed.buildId });
  window.location.reload();
  return { ok: true };
}
