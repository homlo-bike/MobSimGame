import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteStoredProject,
  LIBRARY_KEY,
  listStoredProjects,
  loadFromLocalStorage,
  loadStoredProject,
  projectKey,
  saveToLocalStorage,
  STORAGE_KEY,
} from './persistence';
import { blankProject } from './projectStore';
import { buildDemoProject } from '../test/fixtures/demoProject';

describe('browser project library', () => {
  beforeEach(() => localStorage.clear());

  it('stores several projects and restores the active one', () => {
    const a = { ...blankProject(), name: 'A', updatedAt: '2026-01-01T00:00:00Z' };
    const b = { ...blankProject(), name: 'B', updatedAt: '2026-02-01T00:00:00Z' };
    expect(saveToLocalStorage(a).ok).toBe(true);
    expect(saveToLocalStorage(b).ok).toBe(true);
    expect(listStoredProjects().map((p) => p.name)).toEqual(['B', 'A']);
    expect(loadFromLocalStorage()!.id).toBe(b.id);
    saveToLocalStorage(a);
    expect(loadFromLocalStorage()!.id).toBe(a.id);
    deleteStoredProject(a.id);
    expect(loadStoredProject(a.id)).toBeNull();
    expect(listStoredProjects().map((p) => p.name)).toEqual(['B']);
  });

  it('migrates the single project stored by earlier versions', () => {
    const p = buildDemoProject();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    expect(loadFromLocalStorage()!.id).toBe(p.id);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(projectKey(p.id))).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!).activeId).toBe(p.id);
  });

  it('returns null on a first visit', () => {
    expect(loadFromLocalStorage()).toBeNull();
    expect(listStoredProjects()).toEqual([]);
  });
});
