import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { blankProject, useStore } from './projectStore';
import { buildDemoProject } from '../test/fixtures/demoProject';

describe('active project requirement', () => {
  beforeEach(() => {
    act(() => {
      useStore.getState().loadProject(blankProject());
      useStore.setState({ projectActive: false, tool: 'select' });
      useStore.getState().closeProjectGate();
    });
  });

  it('asks for a project before drawing and resumes drawing afterwards', () => {
    act(() => useStore.getState().setTool('draw_line'));
    expect(useStore.getState().tool).toBe('select');
    expect(useStore.getState().projectGate).toMatchObject({ open: true, resume: 'draw_line' });
    act(() => void useStore.getState().createProject({ name: 'Tram study', description: 'North' }));
    const s = useStore.getState();
    expect(s.projectActive).toBe(true);
    expect(s.project).toMatchObject({ name: 'Tram study', description: 'North' });
    expect(s.projectGate.open).toBe(false);
    expect(s.tool).toBe('draw_line');
  });

  it('cancelling leaves no project and no drawing', () => {
    act(() => useStore.getState().setTool('draw_line'));
    act(() => useStore.getState().closeProjectGate());
    expect(useStore.getState().projectActive).toBe(false);
    expect(useStore.getState().tool).toBe('select');
    expect(useStore.getState().projectGate.resume).toBeNull();
  });

  it('selecting an existing project also resumes the drawing', () => {
    act(() => useStore.getState().setTool('draw_line'));
    act(() => useStore.getState().activateProject(buildDemoProject()));
    expect(useStore.getState().tool).toBe('draw_line');
    expect(useStore.getState().project.name).toBe('Fictional demo city');
  });

  it('draws immediately with an active project', () => {
    act(() => useStore.getState().loadProject(buildDemoProject()));
    act(() => useStore.getState().setTool('draw_line'));
    expect(useStore.getState().tool).toBe('draw_line');
    expect(useStore.getState().projectGate.open).toBe(false);
  });
});
