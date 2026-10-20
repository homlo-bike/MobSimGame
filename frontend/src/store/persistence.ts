/**
 * Local browser persistence and project file I/O. Projects stay in the browser
 * unless the user explicitly saves or shares them through the backend.
 */
import type { Project } from '../domain/schema';
import { parseProject } from '../domain/schema';
import { createLogger, errorContext } from '../util/logger';

const log = createLogger('persistence');
/** Autosave runs after every edit; report a failing browser storage once, not per keystroke. */
let saveFailureReported = false;

/** Before the project library: one project under this key (migrated on first load). */
export const STORAGE_KEY = 'mobsimgame.project.v1';
/** Index of the projects stored in this browser and which one is active. */
export const LIBRARY_KEY = 'mobsimgame.projects.v1';
export const projectKey = (id: string) => `mobsimgame.project.v1:${id}`;
export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

export interface StoredProjectSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
}

interface Library {
  activeId: string | null;
  projects: StoredProjectSummary[];
}

function readLibrary(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const lib = JSON.parse(raw) as Library;
      if (Array.isArray(lib.projects)) return lib;
    }
  } catch {
    /* fall through to an empty library */
  }
  return { activeId: null, projects: [] };
}

function writeLibrary(lib: Library) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

/** Move a project stored under the old single-project key into the library (once). */
function migrateLegacyStorage() {
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return;
    const lib = readLibrary();
    const parsed = parseProject(JSON.parse(legacy));
    if (parsed.ok && !lib.projects.some((p) => p.id === parsed.project.id)) {
      localStorage.setItem(projectKey(parsed.project.id), legacy);
      lib.projects.push(summary(parsed.project));
      lib.activeId = lib.activeId ?? parsed.project.id;
      writeLibrary(lib);
      log.info('moved the stored project into the project library', { projectId: parsed.project.id });
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    log.warn('could not migrate the stored project', errorContext(e));
  }
}

const summary = (p: Project): StoredProjectSummary => ({
  id: p.id,
  name: p.name,
  description: p.description,
  updatedAt: p.updatedAt,
});

/** Save a project in this browser's library and make it the active one. */
export function saveToLocalStorage(project: Project): { ok: boolean; error?: string } {
  try {
    const json = JSON.stringify(project);
    localStorage.setItem(projectKey(project.id), json);
    const lib = readLibrary();
    lib.projects = [summary(project), ...lib.projects.filter((p) => p.id !== project.id)];
    lib.activeId = project.id;
    writeLibrary(lib);
    if (saveFailureReported) log.info('autosave to browser storage works again');
    saveFailureReported = false;
    log.debug('project autosaved', { bytes: json.length });
    return { ok: true };
  } catch (e) {
    if (!saveFailureReported) log.warn('autosave to browser storage failed', errorContext(e));
    saveFailureReported = true;
    return { ok: false, error: e instanceof Error ? e.message : 'Local storage unavailable' };
  }
}

/** Projects stored in this browser, most recently changed first. */
export function listStoredProjects(): StoredProjectSummary[] {
  if (typeof localStorage === 'undefined') return [];
  migrateLegacyStorage();
  return [...readLibrary().projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadStoredProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    const parsed = parseProject(JSON.parse(raw));
    if (!parsed.ok) {
      log.warn('stored project is invalid and was ignored', {
        projectId: id,
        errors: parsed.errors.length,
        first: parsed.errors[0],
      });
      return null;
    }
    return parsed.project;
  } catch (e) {
    log.warn('could not read browser storage', errorContext(e));
    return null;
  }
}

/** The active project of this browser, or null on a first visit. */
export function loadFromLocalStorage(): Project | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    migrateLegacyStorage();
    const lib = readLibrary();
    const id = lib.activeId ?? lib.projects[0]?.id;
    const project = id ? loadStoredProject(id) : null;
    if (project) log.info('project restored from browser storage', { scenarios: project.scenarios.length });
    return project;
  } catch (e) {
    log.warn('could not read browser storage', errorContext(e));
    return null;
  }
}

export function deleteStoredProject(id: string) {
  try {
    localStorage.removeItem(projectKey(id));
    const lib = readLibrary();
    lib.projects = lib.projects.filter((p) => p.id !== id);
    if (lib.activeId === id) lib.activeId = null;
    writeLibrary(lib);
  } catch (e) {
    log.warn('could not delete a stored project', errorContext(e));
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
