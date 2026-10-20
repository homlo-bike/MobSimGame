/**
 * Project metric frame for track geometry.
 *
 * Track geometry (lines, arcs, radii, offsets) is computed in metres in a
 * transverse Mercator projection on the WGS84 ellipsoid, centred on a fixed
 * project origin: the central meridian is the origin's longitude, the scale
 * factor is 1, and the origin maps to (0, 0). x is east, y is north.
 *
 * Accuracy: the series (Krüger, as given by Karney 2011, "Transverse Mercator
 * with an accuracy of a few nanometers", J. Geodesy 85) is accurate to well under a
 * millimetre in position for points within a few thousand kilometres of the
 * central meridian. Distances in the frame are true ground distances times the
 * point scale factor k ≈ 1 + x²/(2R²): +0.012 % at 10 km and +0.12 % at 30 km
 * from the origin. That is sketch accuracy, not survey accuracy.
 *
 * Never compute radii or offsets directly in latitude and longitude degrees.
 */
import type { LngLat } from '../../domain/schema';

export type Vec = [x: number, y: number];

const A_AXIS = 6378137;
const FLATTENING = 1 / 298.257223563;
const N = FLATTENING / (2 - FLATTENING);
const E = Math.sqrt(FLATTENING * (2 - FLATTENING));
const n2 = N * N;
const n3 = n2 * N;
const n4 = n3 * N;
const n5 = n4 * N;
const n6 = n5 * N;
/** Rectifying radius. */
const A = (A_AXIS / (1 + N)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

const ALPHA = [
  N / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
  (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
  (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
  (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
  (212378941 * n6) / 319334400,
];
const BETA = [
  N / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
  (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
  (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
  (4583 * n5) / 161280 - (108847 * n6) / 3991680,
  (20648693 * n6) / 638668800,
];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** τ' (conformal latitude tangent) from τ = tan φ. */
function tauPrime(tau: number): number {
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  return tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
}

/** Inverse of tauPrime by Newton iteration (converges in 2–3 steps). */
function tauFromPrime(tp: number): number {
  let tau = tp;
  for (let i = 0; i < 8; i++) {
    const tpi = tauPrime(tau);
    const d =
      ((tp - tpi) / Math.sqrt(1 + tpi * tpi)) *
      ((1 + (1 - E * E) * tau * tau) / ((1 - E * E) * Math.sqrt(1 + tau * tau)));
    tau += d;
    if (Math.abs(d) < 1e-14) break;
  }
  return tau;
}

/** Transverse Mercator with central meridian lon0, scale 1: [easting, northing] in metres. */
function forwardTM(lng: number, lat: number, lon0: number): Vec {
  const lam = rad(lng - lon0);
  const tp = tauPrime(Math.tan(rad(lat)));
  const xiP = Math.atan2(tp, Math.cos(lam));
  const etaP = Math.asinh(Math.sin(lam) / Math.sqrt(tp * tp + Math.cos(lam) ** 2));
  let xi = xiP;
  let eta = etaP;
  ALPHA.forEach((a, j) => {
    const k = 2 * (j + 1);
    xi += a * Math.sin(k * xiP) * Math.cosh(k * etaP);
    eta += a * Math.cos(k * xiP) * Math.sinh(k * etaP);
  });
  return [A * eta, A * xi];
}

function inverseTM(x: number, y: number, lon0: number): LngLat {
  const xi = y / A;
  const eta = x / A;
  let xiP = xi;
  let etaP = eta;
  BETA.forEach((b, j) => {
    const k = 2 * (j + 1);
    xiP -= b * Math.sin(k * xi) * Math.cosh(k * eta);
    etaP -= b * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const tp = Math.sin(xiP) / Math.sqrt(Math.sinh(etaP) ** 2 + Math.cos(xiP) ** 2);
  const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return [lon0 + deg(lam), deg(Math.atan(tauFromPrime(tp)))];
}

/** A fixed metric frame for one project. */
export interface MetricFrame {
  origin: LngLat;
  toMetres: (p: LngLat) => Vec;
  toLngLat: (p: Vec) => LngLat;
}

export function createFrame(origin: LngLat): MetricFrame {
  if (!Number.isFinite(origin[0]) || !Number.isFinite(origin[1]) || Math.abs(origin[1]) > 89)
    throw new RangeError('Frame origin must be a valid [longitude, latitude] away from the poles');
  const y0 = forwardTM(origin[0], origin[1], origin[0])[1];
  return {
    origin: [origin[0], origin[1]],
    toMetres: (p) => {
      const [x, y] = forwardTM(p[0], p[1], origin[0]);
      return [x, y - y0];
    },
    toLngLat: (p) => inverseTM(p[0], p[1] + y0, origin[0]),
  };
}
