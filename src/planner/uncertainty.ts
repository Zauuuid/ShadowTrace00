/**
 * Touchdown uncertainty model (Monte Carlo) on NASA LOLA heights.
 *
 * The user's dispersion (metres towards N, E, S, W) is read as a k-sigma bound (default k = 3). For a 2-D
 * normal, P(inside the k-sigma ellipse) = 1 − exp(−k²/2): 98.9 % for k = 3 (not the 1-D 99.7 %). Each touchdown is drawn from a split-normal distribution per axis
 * (σ_north = N/k for northward offsets, σ_south = S/k for southward ones, same for E/W), so asymmetric
 * dispersions stay asymmetric. A seeded PRNG makes every run reproducible: the same inputs give the same points.
 *
 * At each touchdown we evaluate, from the DEM only:
 *   slope  — over a baseline of max(leg span, 2 × grid spacing) (a DEM cannot resolve shorter baselines);
 *   relief — RMS residual of the 3×3 neighbourhood (grid spacing apart) after removing the best-fit plane:
 *            terrain variability at DEM scale. It is NOT boulder or rock hazard (needs LROC NAC, 0.5 m/px).
 * A touchdown is "assessed safe" when slope ≤ the spacecraft's limit. P(safe) is the fraction of assessed-safe
 * touchdowns with a Wilson 95 % interval. It is a MODELLED probability under the stated assumptions, not a
 * measured certainty.
 */
import { offset, type XY } from './polar';
import type { Dispersion } from './landing';
import { slopeAt } from './landing';
import type { PolarTerrain } from './terrain';

export interface TouchdownModel {
  /** The dispersion values are k·σ (default 3). */
  readonly sigmaLevel: number;
  readonly samples: number;
  readonly seed: number;
}
export const DEFAULT_MODEL: TouchdownModel = { sigmaLevel: 3, samples: 600, seed: 20261115 };

export type TouchdownCause = 'ok' | 'slope' | 'nodata';
export interface Touchdown {
  /** Ground offset from the aim point (m): east, north. */
  readonly e: number;
  readonly n: number;
  readonly slopeDeg: number;
  readonly reliefM: number;
  readonly cause: TouchdownCause;
}
export interface TouchdownResult {
  readonly points: readonly Touchdown[];
  readonly valid: number;
  readonly safe: number;
  readonly pSafe: number;
  readonly ci95: readonly [number, number];
  /** Share of samples with DEM coverage (%). */
  readonly coveragePct: number;
  readonly gridM: number;
  readonly baselineM: number;
  readonly slopeMeanDeg: number;
  readonly slopeP95Deg: number;
  readonly slopeSdDeg: number;
  readonly reliefP95M: number;
  readonly model: TouchdownModel;
}

/** mulberry32: tiny deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal pair via Box–Muller. */
function normals(r: () => number): [number, number] {
  const u = Math.max(r(), 1e-12);
  const v = r();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

/** Wilson score interval (95 %). */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.959964;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Touchdown offsets (east, north metres) for a dispersion, deterministic for a seed. */
export function sampleOffsets(d: Dispersion, m: TouchdownModel): { e: number; n: number }[] {
  const r = rng(m.seed);
  const out: { e: number; n: number }[] = [];
  const k = m.sigmaLevel > 0 ? m.sigmaLevel : 3;
  for (let i = 0; i < m.samples; i++) {
    const [ze, zn] = normals(r);
    out.push({ e: (ze * (ze >= 0 ? d.eastM : d.westM)) / k, n: (zn * (zn >= 0 ? d.northM : d.southM)) / k });
  }
  return out;
}

/** RMS residual (m) of the 3×3 neighbourhood around q (spacing `stepM`) after removing the best-fit plane. */
export function reliefAt(t: PolarTerrain, q: XY, stepM: number): number {
  const z: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      // i: east steps, j: north steps (local axes through offset)
      let p = q;
      if (j !== 0) p = offset(p, j > 0 ? 0 : 180, stepM);
      if (i !== 0) p = offset(p, i > 0 ? 90 : 270, stepM);
      const h = t.heightAt(p);
      if (!Number.isFinite(h)) return Number.NaN;
      z.push(h); xs.push(i); ys.push(j);
    }
  }
  // Symmetric 3×3 grid: plane coefficients decouple (Σx = Σy = Σxy = 0, Σx² = Σy² = 6).
  const mean = z.reduce((s, v) => s + v, 0) / 9;
  let a = 0, b = 0;
  for (let k = 0; k < 9; k++) { a += xs[k]! * z[k]!; b += ys[k]! * z[k]!; }
  a /= 6; b /= 6;
  let ss = 0;
  for (let k = 0; k < 9; k++) { const r = z[k]! - (mean + a * xs[k]! + b * ys[k]!); ss += r * r; }
  return Math.sqrt(ss / 9);
}

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

export function simulateTouchdowns(
  t: PolarTerrain, aim: XY, d: Dispersion, legSpanM: number, maxSlopeDeg: number, model: TouchdownModel = DEFAULT_MODEL,
): TouchdownResult {
  const gridM = t.hasDetail(aim) ? 40 : 240;
  const baselineM = Math.max(legSpanM, 2 * gridM);
  const points: Touchdown[] = [];
  const slopes: number[] = [];
  const reliefs: number[] = [];
  let safe = 0;
  for (const o of sampleOffsets(d, model)) {
    const dist = Math.hypot(o.e, o.n);
    const az = (Math.atan2(o.e, o.n) * 180) / Math.PI;
    const q = dist > 0 ? offset(aim, az, dist) : aim;
    const s = slopeAt(t, q, baselineM);
    const rel = Number.isFinite(s) ? reliefAt(t, q, gridM) : Number.NaN;
    let cause: TouchdownCause = 'ok';
    if (!Number.isFinite(s)) cause = 'nodata';
    else if (s > maxSlopeDeg) cause = 'slope';
    if (cause === 'ok') safe++;
    if (Number.isFinite(s)) slopes.push(s);
    if (Number.isFinite(rel)) reliefs.push(rel);
    points.push({ e: o.e, n: o.n, slopeDeg: s, reliefM: rel, cause });
  }
  const valid = slopes.length;
  slopes.sort((a, b) => a - b);
  reliefs.sort((a, b) => a - b);
  const mean = valid ? slopes.reduce((s, v) => s + v, 0) / valid : Number.NaN;
  const sd = valid ? Math.sqrt(slopes.reduce((s, v) => s + (v - mean) ** 2, 0) / valid) : Number.NaN;
  return {
    points, valid, safe,
    pSafe: valid ? safe / valid : 0,
    ci95: wilson(safe, valid),
    coveragePct: model.samples ? (100 * valid) / model.samples : 0,
    gridM, baselineM,
    slopeMeanDeg: mean, slopeP95Deg: percentile(slopes, 95), slopeSdDeg: sd,
    reliefP95M: percentile(reliefs, 95),
    model,
  };
}
