/** Runtime connection and version state (UI state, never saved in the project). */
import { create } from 'zustand';
import type { ConnectionStatus, HealthResult } from '../runtime/connectivity';
import type { BuildInfo } from '../runtime/version';

export interface ConnectionState {
  browserOnline: boolean;
  health: HealthResult | null;
  lastCheckedAt: string | null;
  status: ConnectionStatus;
  deployed: BuildInfo | null;
  updateAvailable: boolean;
  /** Set when an automatic reload did not bring the new version (reload-loop guard). */
  updateBlocked: string | null;
  updating: boolean;
  set: (patch: Partial<Omit<ConnectionState, 'set'>>) => void;
}

export const useConnection = create<ConnectionState>()((set) => ({
  browserOnline: true,
  health: null,
  lastCheckedAt: null,
  status: 'checking',
  deployed: null,
  updateAvailable: false,
  updateBlocked: null,
  updating: false,
  set: (patch) => set(patch),
}));
