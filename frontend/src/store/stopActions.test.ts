import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { blankProject, useStore } from './projectStore';
import { activeScenario } from '../domain/network';
import { addDraftStop, drawingStops, finishStopDraft, removeLastDraftStop } from './stopActions';
import { xy } from '../test/fixtures/tracks';

// Routing needs a server; here it is not reached.
vi.mock('../routing/autoRoute', () => ({ autoRoute: vi.fn(async () => undefined) }));

describe('drawing a street line stop by stop', () => {
  beforeEach(() => {
    act(() => {
      useStore.getState().loadProject(blankProject());
      useStore.setState({ projectActive: true, tool: 'select', newLineMode: 'trolleybus', stopDraft: [] });
      useStore.getState().setTool('draw_line');
    });
  });

  it('collects clicked stops and creates a one-way loop line', () => {
    expect(drawingStops()).toBe(true);
    act(() => {
      addDraftStop(xy(0, 0));
      addDraftStop(xy(0, 0)); // same point twice: ignored
      addDraftStop(xy(400, 0));
      addDraftStop(xy(400, 300));
      removeLastDraftStop();
      addDraftStop(xy(400, 350));
    });
    expect(useStore.getState().stopDraft).toHaveLength(3);
    let id: string | null = null;
    act(() => {
      id = finishStopDraft();
    });
    const s = useStore.getState();
    const line = activeScenario(s.project).lines.find((l) => l.id === id)!;
    expect(line).toMatchObject({ mode: 'trolleybus', direction: 'one_way', termination: { kind: 'ring' } });
    expect(line.stops).toHaveLength(3);
    expect(s.tool).toBe('select');
    expect(s.stopDraft).toEqual([]);
    expect(s.selection).toEqual({ kind: 'line', id });
  });

  it('finishing with one stop cancels', () => {
    act(() => addDraftStop(xy(0, 0)));
    act(() => void finishStopDraft());
    expect(activeScenario(useStore.getState().project).lines).toHaveLength(0);
    expect(useStore.getState().tool).toBe('select');
  });

  it('switching mode discards the draft', () => {
    act(() => addDraftStop(xy(0, 0)));
    act(() => useStore.getState().setNewLineMode('bus'));
    expect(useStore.getState().stopDraft).toEqual([]);
  });
});
