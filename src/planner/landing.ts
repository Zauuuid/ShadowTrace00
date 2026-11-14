/**
 * Landing-zone check from NASA LOLA heights (40 m grid near the pole, 240 m elsewhere).
 * The touchdown point can land anywhere inside an asymmetric ellipse around the aim point: the user gives the
 * possible drift towards north, east, south and west in metres. Inside that zone we sample points every
 * ~20 m and compute the terrain slope over a baseline of max(leg span, 2 × grid spacing): the DEM cannot
 * resolve slopes over a shorter distance than its own spacing, so a 4 m leg span is evaluated over 80 m.
 * If any point exceeds the slope limit, we search outward for safe aim points (whole zone within the limit): the
 * nearest one in each compass direction (8), ranked nearest first (at most 5).
 */
import { offset, type XY } from './polar';
import type { PolarTerrain } from './terrain';

export interface Dispersion {
  readonly northM: number;
  readonly eastM: number;
  readonly southM: number;
  readonly westM: number;
}

export interface ZoneResult {
  readonly maxSlopeDeg: number;
  readonly maxSlopeAzDeg: number;
  readonly meanSlopeDeg: number;
  readonly unsafePct: number;
  /** Height change across the leg span at the steepest point (m). */
  readonly legDropM: number;
  readonly baselineM: number;
  /** Max slope per 45° sector (N, NE, E, SE, S, SW, W, NW). */
  readonly sectors: readonly number[];
  readonly samples: number;
}

export interface AimSuggestion {
  readonly distanceM: number;
  readonly azDeg: number;
  readonly aim: XY;
  readonly maxSlopeDeg: number;
}

export interface LandingResult extends ZoneResult {
  readonly safe: boolean;
  /** The nearest safe aim point (= safeAims[0]). */
  readonly suggestion: AimSuggestion | null;
  /** Safe aim points, nearest first, one per direction, at most 5 (empty when the zone is already safe). */
  readonly safeAims: readonly AimSuggestion[];
}

const MAX_AIMS = 5;

const D = Math.PI / 180;

export function slopeAt(t: PolarTerrain, q: XY, baselineM: number): number {
  const h = (az: number) => t.heightAt(offset(q, az, baselineM / 2));
  const dn = h(0) - h(180);
  const de = h(90) - h(270);
  if (![dn, de].every(Number.isFinite)) return Number.NaN;
  return Math.atan(Math.hypot(dn, de) / baselineM) / D;
}

/** Ellipse radius towards azimuth az for an asymmetric dispersion (quarter-ellipses). */
export function radiusTowards(d: Dispersion, azDeg: number): number {
  const s = Math.sin(azDeg * D);
  const c = Math.cos(azDeg * D);
  const a = c >= 0 ? d.northM : d.southM;
  const b = s >= 0 ? d.eastM : d.westM;
  if (a <= 0 || b <= 0) return Math.max(0, Math.abs(c) > Math.abs(s) ? a : b);
  return 1 / Math.sqrt((c / a) ** 2 + (s / b) ** 2);
}

export function analyseZone(t: PolarTerrain, aim: XY, d: Dispersion, legSpanM: number, maxSlopeDeg: number, gridM: number): ZoneResult {
  const baselineM = Math.max(legSpanM, 2 * gridM);
  const sectors = new Array<number>(8).fill(0);
  let max = 0, maxAz = 0, sum = 0, count = 0, unsafe = 0;
  const reach = Math.max(d.northM, d.eastM, d.southM, d.westM);
  const ringStep = Math.max(20, reach / 12);
  for (let r = 0; r <= reach + 1e-6; r += ringStep) {
    const nAz = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / ringStep));
    for (let k = 0; k < nAz; k++) {
      const az = (360 * k) / nAz;
      if (r > radiusTowards(d, az) + 1e-6) continue;
      const s = slopeAt(t, offset(aim, az, r), baselineM);
      if (!Number.isFinite(s)) continue;
      count++;
      sum += s;
      if (s > maxSlopeDeg) unsafe++;
      const sec = Math.round(az / 45) % 8;
      sectors[sec] = Math.max(sectors[sec]!, s);
      if (s > max) { max = s; maxAz = az; }
    }
  }
  return {
    maxSlopeDeg: max, maxSlopeAzDeg: maxAz, meanSlopeDeg: count ? sum / count : Number.NaN,
    unsafePct: count ? (100 * unsafe) / count : 0, legDropM: Math.tan(max * D) * legSpanM, baselineM, sectors, samples: count,
  };
}

export function analyseLanding(t: PolarTerrain, aim: XY, d: Dispersion, legSpanM: number, maxSlopeDeg: number): LandingResult {
  const gridM = t.hasDetail(aim) ? 40 : 240;
  const zone = analyseZone(t, aim, d, legSpanM, maxSlopeDeg, gridM);
  if (zone.samples === 0) return { ...zone, safe: false, suggestion: null, safeAims: [] };
  if (zone.maxSlopeDeg <= maxSlopeDeg) return { ...zone, safe: true, suggestion: null, safeAims: [] };
  const found: AimSuggestion[] = [];
  // one suggestion per compass direction (N, NE, E, …), so every option reads differently
  const done = new Set<number>();
  const octant = (az: number) => Math.round(az / 45) % 8;
  for (let dist = 40; dist <= 2000 && found.length < MAX_AIMS; dist += 40) {
    const ring: AimSuggestion[] = [];
    for (let az = 0; az < 360; az += 22.5) {
      if (done.has(octant(az))) continue;
      const cand = offset(aim, az, dist);
      const z = analyseZone(t, cand, d, legSpanM, maxSlopeDeg, gridM);
      if (z.samples > 0 && z.maxSlopeDeg <= maxSlopeDeg) ring.push({ distanceM: dist, azDeg: az, aim: cand, maxSlopeDeg: z.maxSlopeDeg });
    }
    ring.sort((a, b) => a.maxSlopeDeg - b.maxSlopeDeg);
    for (const s of ring) {
      if (found.length >= MAX_AIMS) break;
      if (done.has(octant(s.azDeg))) continue;
      found.push(s);
      done.add(octant(s.azDeg));
    }
  }
  return { ...zone, safe: false, suggestion: found[0] ?? null, safeAims: found };
}

function inside(ring: readonly (readonly number[])[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}

/**
 * Highest LOLA point inside a polygon (map metres), sampled every `stepM`. On the south pole the high ridges are the
 * best-lit places, so this is where a region chip puts the pin (instead of the polygon's geometric centre).
 */
export function highestPoint(t: PolarTerrain, ring: readonly (readonly number[])[], stepM = 240): XY {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x!); x1 = Math.max(x1, x!); y0 = Math.min(y0, y!); y1 = Math.max(y1, y!); }
  let best: XY = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  let bestH = -Infinity;
  for (let x = x0; x <= x1; x += stepM) {
    for (let y = y0; y <= y1; y += stepM) {
      if (!inside(ring, x, y)) continue;
      const h = t.heightAt({ x, y });
      if (Number.isFinite(h) && h > bestH) { bestH = h; best = { x, y }; }
    }
  }
  return best;
}
