/**
 * Pixel pictograms for station access facilities (R8): an elevator (car with up and down
 * arrows), an escalator (rising steps) and a ramp (slope). Each is a dark shape on a white
 * tile with a dark border, so the meaning is in the shape, not in a colour. Pure.
 */
import type { AccessFacility } from '../domain/stationAccess';

const GLYPHS: Record<AccessFacility, string[]> = {
  elevator: [
    '............',
    '.##########.',
    '.#...##...#.',
    '.#..####..#.',
    '.#.######.#.',
    '.#........#.',
    '.#........#.',
    '.#.######.#.',
    '.#..####..#.',
    '.#...##...#.',
    '.##########.',
    '............',
  ],
  escalator: [
    '............',
    '.........###',
    '.........#..',
    '.......###..',
    '.......#....',
    '.....###....',
    '.....#......',
    '...###......',
    '...#........',
    '.###........',
    '.#..........',
    '............',
  ],
  ramp: [
    '............',
    '............',
    '..........#.',
    '.........##.',
    '........###.',
    '.......####.',
    '......#####.',
    '.....######.',
    '....#######.',
    '...########.',
    '.##########.',
    '............',
  ],
};

const GLYPH = 12;
const TILE = GLYPH + 4;
const GAP = 2;
const DARK = [17, 24, 39, 255];
const WHITE = [255, 255, 255, 255];

/** RGBA image with one tile per facility, side by side. */
export function accessImage(facilities: readonly AccessFacility[]): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const n = Math.max(1, facilities.length);
  const width = n * TILE + (n - 1) * GAP;
  const height = TILE;
  const data = new Uint8Array(width * height * 4);
  facilities.forEach((f, k) => {
    const x0 = k * (TILE + GAP);
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const border = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        const g = GLYPHS[f][y - 2]?.[x - 2];
        data.set(border || g === '#' ? DARK : WHITE, (y * width + x0 + x) * 4);
      }
  });
  return { width, height, data };
}
