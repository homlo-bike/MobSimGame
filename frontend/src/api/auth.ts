/**
 * Login for saving and sharing projects on the server. The session token lives
 * in sessionStorage (this tab only) and is sent as a bearer token. It is never
 * logged. The editor itself needs no login.
 */
import { apiFetch, ProviderError } from '../providers/backend';
import { createLogger } from '../util/logger';

const log = createLogger('auth');
const SESSION_KEY = 'mobsimgame.session.v1';

export interface ServerSession {
  username: string;
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

export function currentSession(now = Date.now() / 1000): ServerSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ServerSession;
    if (!s.token || s.expiresAt <= now) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function authHeaders(): Record<string, string> {
  const s = currentSession();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}

export async function login(username: string, password: string): Promise<ServerSession> {
  let res: Response;
  try {
    res = await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    if (e instanceof ProviderError && e.state === 'authentication_required')
      throw new ProviderError('Wrong username or password', 'authentication_required');
    throw e;
  }
  if (!res.ok) throw new ProviderError(`Login failed (HTTP ${res.status})`, 'temporarily_unavailable');
  const body = (await res.json()) as { username: string; token: string; expires_at: number };
  const session = { username: body.username, token: body.token, expiresAt: body.expires_at };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable: the session lasts until the page is reloaded */
  }
  log.info('signed in');
  return session;
}

export function logout() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing stored */
  }
  log.info('signed out');
}
