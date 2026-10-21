import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { activeScenario } from '../domain/network';
import { createTracks, nodeEnds } from '../domain/tracks';
import { blankProject, useStore } from '../store/projectStore';
import { NodeInspector } from './TrackInspector';
import { xy } from '../test/fixtures/tracks';

function Current({ nodeId }: { nodeId: string }) {
  const sc = useStore((s) => activeScenario(s.project));
  const node = sc.trackNetwork.nodes.find((n) => n.id === nodeId)!;
  return <NodeInspector node={node} scenario={sc} />;
}

describe('turnout section', () => {
  it('sets a turnout with a standard design from the node inspector (keyboard and pointer)', async () => {
    act(() => useStore.getState().loadProject(blankProject()));
    let s = activeScenario(useStore.getState().project);
    s = createTracks(s, { points: [xy(0, 0), xy(400, 0)], mode: 'commuter_rail', double: false }).scenario;
    s = createTracks(s, {
      points: [xy(200, 0), xy(320, 0), xy(450, 80)],
      mode: 'commuter_rail',
      double: false,
      radii: [null, 300, null],
    }).scenario;
    act(() => useStore.getState().commitScenario(s));
    const nodeId = s.trackNetwork.nodes.find((n) => nodeEnds(s.trackNetwork, n.id).length === 3)!.id;
    render(<Current nodeId={nodeId} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Type'), 'simple');
    expect(screen.getByText(/Switch toe:/)).toBeInTheDocument();
    expect(screen.getByText(/drawn with 300 m/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Design'), 'db-ew-300-9');
    expect(screen.getByText(/50 km\/h on the diverging route/)).toBeInTheDocument();
    const node = activeScenario(useStore.getState().project).trackNetwork.nodes.find((n) => n.id === nodeId)!;
    expect(node.turnout).toMatchObject({ kind: 'simple', designId: 'db-ew-300-9' });
    expect(node.movementMode).toBe('turnout');
    expect(node.movements).toHaveLength(2);
  });
});
