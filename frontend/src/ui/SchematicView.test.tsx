import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useStore } from '../store/projectStore';
import { buildDemoProject } from '../test/fixtures/demoProject';
import { SchematicView } from './SchematicView';

describe('schematic view', () => {
  it('selects a station with Enter, moves it with the arrow keys and lists the lines as text', () => {
    act(() => useStore.getState().loadProject(buildDemoProject()));
    render(<SchematicView />);
    const svg = screen.getByRole('img', { name: /Schematic network map/ });
    const station = within(svg).getAllByRole('button')[0]!;
    fireEvent.keyDown(station, { key: 'Enter' });
    const sel = useStore.getState().selection;
    expect(sel?.kind).toBe('station');
    fireEvent.keyDown(station, { key: 'ArrowRight' });
    const offsets = useStore.getState().project.scenarios[0]!.schematicOffsets;
    expect(Object.values(offsets).some((o) => o.dx > 0)).toBe(true);
    // Text view: one ordered list per line, stations as buttons that select them.
    const text = screen.getByRole('heading', { name: 'Text view' }).closest('section') ?? document.body;
    expect(within(text as HTMLElement).getAllByRole('list').length).toBeGreaterThan(0);
    // Zoom buttons change the view; Fit restores it.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in on the schematic' }));
    expect(svg.getAttribute('viewBox')).not.toBe(svg.getAttribute('data-full-viewbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(svg.getAttribute('viewBox')).toBe(svg.getAttribute('data-full-viewbox'));
  });
});
