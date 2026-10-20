/**
 * Versioned geometric validation profiles per mode.
 *
 * Horizontal curve radii are DOCUMENTED DEFAULTS taken from published design
 * guidance (see CURVE_RADIUS_RULES; reviewed by the project owner before use).
 * All other thresholds (grades, stop spacing, structure lengths) are still
 * UNCITED PLACEHOLDERS: they produce advisory findings only and say so.
 * See docs/METHODOLOGY.md, "Mode profiles".
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
  /** Cited horizontal curve radius rule; null where the mode has none (road and active modes). */
  curveRadius: CurveRadiusRule | null;
  /** Maximum longitudinal grade in percent (smaller is better). */
  maxGradePercent: ProfileThreshold;
  /** Minimum distance between consecutive stops (larger is better). */
  minStopSpacingM: ProfileThreshold;
  /** Maximum distance between consecutive stops (smaller is better). */
  maxStopSpacingM: ProfileThreshold;
  /** Minimum length of a segment with one structure type (larger is better). */
  minStructureSegmentM: ProfileThreshold;
}

export interface CurveRadiusSource {
  title: string;
  publisher: string;
  year: string;
  section: string;
  url: string;
  /** Short verbatim quote containing the value. */
  quote: string;
}

/**
 * Minimum horizontal radius: below `minimumM` is a blocking error, below
 * `recommendedM` a warning. Values are in metres and apply to the track
 * centreline of a sketched alignment.
 */
export interface CurveRadiusRule {
  minimumM: number;
  /** Lower minimum on embedded or slab track in streets (light rail only). */
  embeddedMinimumM: number | null;
  /** null where no cited recommended value exists. */
  recommendedM: number | null;
  /** Recommended minimum radius through stations; null where none is cited. */
  stationRecommendedM: number | null;
  status: 'documented_default' | 'user_override';
  context: string;
  sources: CurveRadiusSource[];
}

const TCRP_155 = {
  title: 'TCRP Report 155: Track Design Handbook for Light Rail Transit, 2nd ed.',
  publisher: 'Transportation Research Board (Parsons Brinckerhoff)',
  year: '2012',
  url: 'https://nap.nationalacademies.org/22800',
};

export const CURVE_RADIUS_RULES: Partial<Record<TransportMode, CurveRadiusRule>> = {
  tram: {
    minimumM: 25,
    embeddedMinimumM: null,
    recommendedM: null,
    stationRecommendedM: null,
    status: 'documented_default',
    context:
      'Street-running tram with modern low-floor vehicles. No cited recommended value exists for street running, so only the minimum is checked. Legacy networks use tighter curves with specific vehicles.',
    sources: [
      {
        ...TCRP_155,
        section: '§3.2.3.2, p. 3-11',
        quote:
          'the most common absolute minimum radius is 82 feet [25 meters]… The use of curves tighter than 82 feet [25 meters] is therefore strongly discouraged.',
      },
    ],
  },
  light_rail: {
    minimumM: 90,
    embeddedMinimumM: 25,
    recommendedM: 150,
    stationRecommendedM: null,
    status: 'documented_default',
    context:
      'Segregated light-rail main line. 90 m is the absolute minimum on ballasted track; on street sections (embedded or direct-fixation track) the absolute minimum is 25 m.',
    sources: [
      {
        ...TCRP_155,
        section: '§3.2.3.2, p. 3-13',
        quote:
          'At-Grade Acceptable Minimum. Greater of • 500 feet [150 meters]… Ballasted At-Grade Track, Absolute Minimum. • 300 feet [90 meters]… Embedded Track or Direct Fixation Track, Absolute Minimum. Lesser of • 82 feet [25 meters]',
      },
    ],
  },
  metro: {
    minimumM: 120,
    embeddedMinimumM: null,
    recommendedM: 200,
    stationRecommendedM: 1000,
    status: 'documented_default',
    context:
      'Metro main line. No free national standard was found; these values come from one project design basis (elevated metro, India) and are project-specific.',
    sources: [
      {
        title: 'Detailed Project Report, Mumbai Metro Line 12 (Kalyan–Taloja)',
        publisher: 'MMRDA, prepared by Delhi Metro Rail Corporation',
        year: '2019',
        section: 'Table 4.1, p. 123',
        url: 'https://images.assettype.com/publicpressjournal/2023-01/97e367b3-1860-4de9-b048-ed973272c4ae/Metro_Line_12.pdf',
        quote:
          'Desirable Minimum radius 200m … Absolute minimum radius 120m* … Minimum curve radius at stations 1000m',
      },
    ],
  },
  commuter_rail: {
    minimumM: 150,
    embeddedMinimumM: null,
    recommendedM: 300,
    stationRecommendedM: null,
    status: 'documented_default',
    context:
      'Passenger main line. Minimum: GB exceptional limit for passenger lines. Recommended: German target radius for continuous main tracks on new main lines (Hauptbahnen).',
    sources: [
      {
        title: 'GCRT5021 Track System Requirements, Issue 6',
        publisher: 'RSSB',
        year: '2023',
        section: '§2.5.1.1, Table 1',
        // Read from the RSSB consultation portal copy of the published Issue 6.
        url: 'https://consultations.rssb.co.uk/_entity/sharepointdocumentlocation/e755957b-950b-ee11-8f6e-000d3aba3cb5/2ab10dab-d681-4911-b881-cc99413f07b6?file=06.+GCRT5021+Issue+6.pdf',
        quote: 'Passenger lines 200 150 (normal / exceptional minimum radius, m)',
      },
      {
        title: 'Eisenbahn-Bau- und Betriebsordnung (EBO) §6(1)',
        publisher: 'Bundesministerium der Justiz',
        year: 'current',
        section: '§6(1)',
        url: 'https://www.gesetze-im-internet.de/ebo/__6.html',
        quote:
          'Der Bogenradius in durchgehenden Hauptgleisen soll bei Neubauten nicht weniger als 300 m | 180 m betragen.',
      },
    ],
  },
};
CURVE_RADIUS_RULES.elevated_metro = CURVE_RADIUS_RULES.metro;

const t = (preferred: number, warning: number, units: string): ProfileThreshold => ({
  preferred,
  warning,
  absoluteLimit: null,
  units,
});

const placeholder = (
  mode: TransportMode,
  vehicleType: string,
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
  curveRadius: CURVE_RADIUS_RULES[mode] ?? null,
  source: 'MobSimGame placeholder values for exercising the validation pipeline. Not taken from a standard.',
  sourceDate: null,
  notes:
    'Replace with values from the applicable national standard or operator design manual before relying on findings.',
  maxGradePercent: t(grade[0], grade[1], '%'),
  minStopSpacingM: t(minSpacing[0], minSpacing[1], 'm'),
  maxStopSpacingM: t(maxSpacing[0], maxSpacing[1], 'm'),
  minStructureSegmentM: t(200, 80, 'm'),
});

export const MODE_PROFILES: Record<TransportMode, ModeProfile> = {
  bus: placeholder('bus', 'generic bus', [6, 10], [300, 150], [800, 1500]),
  brt: placeholder('brt', 'generic articulated bus', [6, 10], [400, 250], [1200, 2000]),
  trolleybus: placeholder('trolleybus', 'generic trolleybus', [6, 10], [300, 150], [800, 1500]),
  tram: placeholder('tram', 'generic low-floor tram', [4, 7], [300, 200], [900, 1500]),
  light_rail: placeholder('light_rail', 'generic light-rail vehicle', [4, 6], [500, 300], [1500, 2500]),
  metro: placeholder('metro', 'generic metro train', [3, 4], [700, 400], [2000, 3500]),
  elevated_metro: placeholder('elevated_metro', 'generic metro train', [3, 4], [700, 400], [2000, 3500]),
  commuter_rail: placeholder('commuter_rail', 'generic EMU', [1.5, 2.5], [1000, 600], [5000, 10000]),
  cycling: placeholder('cycling', 'bicycle', [3, 6], [0, 0], [100000, 100000]),
  pedestrian: placeholder('pedestrian', 'pedestrian', [5, 8], [0, 0], [100000, 100000]),
  custom: placeholder('custom', 'custom vehicle', [4, 7], [300, 150], [2000, 4000]),
};
