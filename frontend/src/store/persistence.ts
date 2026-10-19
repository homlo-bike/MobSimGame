/**
 * Local browser persistence and project file I/O. Projects stay in the browser
 * unless the user explicitly saves or shares them through the backend.
 */
import type { Project } from '../domain/schema';
import { parseProject } from '../domain/schema';

export const STORAGE_KEY = 'mobsimgame.project.v1';
export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

export function saveToLocalStorage(project: Project): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Local storage unavailable' };
  }
}

export function loadFromLocalStorage(): Project | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = parseProject(JSON.parse(raw));
    return parsed.ok ? parsed.project : null;
  } catch {
    return null;
  }
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectText(
  text: string,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  if (text.length > MAX_PROJECT_BYTES) return { ok: false, errors: ['File is larger than 20 MB'] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON'] };
  }
  return parseProject(data);
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-z0-9-_]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'project'
  );
}
