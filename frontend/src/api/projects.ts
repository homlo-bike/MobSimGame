/**
 * Backend client for saving and sharing projects. The backend stores a copy of
 * the project only when the user explicitly shares it.
 */
import type { Project } from '../domain/schema';
import { parseProject } from '../domain/schema';
import { apiFetch, ProviderError } from '../providers/backend';
import { createLogger } from '../util/logger';

const log = createLogger('share');

export interface ShareResult {
  id: string;
  editToken: string;
  createdAt: string;
}

const TOKENS_KEY = 'mobsimgame.editTokens.v1';

function tokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberEditToken(id: string, token: string) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify({ ...tokens(), [id]: token }));
  } catch {
    /* storage unavailable: sharing still works, later edits will create a new share */
  }
}

export async function shareProject(project: Project, existingId?: string): Promise<ShareResult> {
  const token = existingId ? tokens()[existingId] : undefined;
  const res = await apiFetch(
    existingId && token ? `/api/v1/projects/${encodeURIComponent(existingId)}` : '/api/v1/projects',
    {
      method: existingId && token ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
      body: JSON.stringify({ project }),
    },
  );
  if (res.status === 413) {
    log.warn('project too large to share', { status: 413 });
    throw new ProviderError('Project is too large to share', 'temporarily_unavailable');
  }
  if (!res.ok) {
    log.error('share failed', { status: res.status, update: !!(existingId && token) });
    throw new ProviderError(`Share failed (HTTP ${res.status})`, 'temporarily_unavailable');
  }
  const body = (await res.json()) as { id: string; edit_token?: string; created_at: string };
  const editToken = body.edit_token ?? token ?? '';
  if (editToken) rememberEditToken(body.id, editToken);
  // The edit token is never logged.
  log.info(existingId && token ? 'shared project updated' : 'project shared', { projectId: body.id });
  return { id: body.id, editToken, createdAt: body.created_at };
}

export async function fetchSharedProject(id: string): Promise<Project> {
  const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new ProviderError('Shared project not found', 'coverage_unavailable');
  if (!res.ok)
    throw new ProviderError(`Could not load shared project (HTTP ${res.status})`, 'temporarily_unavailable');
  const body = (await res.json()) as { project: unknown };
  const parsed = parseProject(body.project);
  if (!parsed.ok) {
    log.error('shared project failed validation', { projectId: id, errors: parsed.errors.length });
    throw new ProviderError(`Shared project is invalid: ${parsed.errors[0]}`, 'temporarily_unavailable');
  }
  log.info('shared project opened', { projectId: id });
  return parsed.project;
}

export async function openServerReport(project: Project) {
  const res = await apiFetch('/api/v1/reports/html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) throw new ProviderError(`Report failed (HTTP ${res.status})`, 'temporarily_unavailable');
  const html = await res.text();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  log.info('server report opened', { bytes: html.length });
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
