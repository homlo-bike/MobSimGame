/**
 * Versioned geometric validation profiles per mode.
 *
 * IMPORTANT: Phase 1 ships only UNCITED PLACEHOLDER profiles. They produce
 * advisory warnings so the validation pipeline can be exercised; they are not
 * engineering criteria. `absoluteLimit` stays null until a value is tied to a
 * cited standard (see docs/METHODOLOGY.md, "Mode profiles").
 */
import type { TransportMode } from './schema';

export interface ProfileThreshold {
  /** Value the designer should aim for. */
  preferred: number;
  /** Beyond this, a Warning finding is raised. */
  warning: number;
  /** Beyond this, a Blocking finding is raised. Only set with a cited standard. */
  absoluteLimit: number | null;
  units: string;
}

export interface ModeProfile {
  id: string;
  version: string;
  mode: TransportMode;
  vehicleType: string;
  standardContext: string;
  cited: boolean;
  source: string;
  sourceDate: string | null;
  notes: string;
  /** Minimum horizontal curve radius (larger is better). */
  minCurveRadiusM: ProfileThreshold;
  /** Maximum longitudinal grade in percent (smaller is better). */
  maxGradePercent: ProfileThreshold;
  /** Minimum distance between consecutive stops (larger is better). */
  minStopSpacingM: ProfileThreshold;
  /** Maximum distance between consecutive stops (smaller is better). */
  maxStopSpacingM: ProfileThreshold;
  /** Minimum length of a segment with one structure type (larger is better). */
  minStructureSegmentM: ProfileThreshold;
}

const t = (preferred: number, warning: number, units: string): ProfileThreshold => ({
  preferred,
  warning,
  absoluteLimit: null,
  units,
});

const placeholder = (
  mode: TransportMode,
  vehicleType: string,
  radius: [number, number],
  grade: [number, number],
  minSpacing: [number, number],
  maxSpacing: [number, number],
): ModeProfile => ({
  id: `placeholder-${mode}`,
  version: '0.1.0',
  mode,
  vehicleType,
  standardContext: 'None (generic placeholder, no country or standard)',
  cited: false,
  source: 'MobSimGame placeholder values for exercising the validation pipeline. Not taken from a standard.',
  sourceDate: null,
  notes:
    'Replace with values from the applicable national standard or operator design manual before relying on findings.',
  minCurveRadiusM: t(radius[0], radius[1], 'm'),
  maxGradePercent: t(grade[0], grade[1], '%'),
  minStopSpacingM: t(minSpacing[0], minSpacing[1], 'm'),
  maxStopSpacingM: t(maxSpacing[0], maxSpacing[1], 'm'),
  minStructureSegmentM: t(200, 80, 'm'),
});

export const MODE_PROFILES: Record<TransportMode, ModeProfile> = {
  bus: placeholder('bus', 'generic bus', [30, 12], [6, 10], [300, 150], [800, 1500]),
  brt: placeholder('brt', 'generic articulated bus', [50, 20], [6, 10], [400, 250], [1200, 2000]),
  tram: placeholder('tram', 'generic low-floor tram', [50, 20], [4, 7], [300, 200], [900, 1500]),
  light_rail: placeholder(
    'light_rail',
    'generic light-rail vehicle',
    [150, 40],
    [4, 6],
    [500, 300],
    [1500, 2500],
  ),
  metro: placeholder('metro', 'generic metro train', [300, 150], [3, 4], [700, 400], [2000, 3500]),
  elevated_metro: placeholder(
    'elevated_metro',
    'generic metro train',
    [300, 150],
    [3, 4],
    [700, 400],
    [2000, 3500],
  ),
  commuter_rail: placeholder(
    'commuter_rail',
    'generic EMU',
    [600, 300],
    [1.5, 2.5],
    [1000, 600],
    [5000, 10000],
  ),
  cycling: placeholder('cycling', 'bicycle', [20, 5], [3, 6], [0, 0], [100000, 100000]),
  pedestrian: placeholder('pedestrian', 'pedestrian', [1, 0.5], [5, 8], [0, 0], [100000, 100000]),
  custom: placeholder('custom', 'custom vehicle', [100, 30], [4, 7], [300, 150], [2000, 4000]),
};
