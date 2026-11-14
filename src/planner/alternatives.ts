/**
 * Nearby alternatives when a plan fails: other aim points within the search radius (same dates), and the same site
 * on nearby dates (same duration). Each candidate is evaluated with the same mission simulation and the same limits;
 * the nearest passing candidates are returned. When fewer than wanted pass, the closest-to-passing candidates fill
 * the list (passes = false, with the rules they still break), ranked by `score` (lower is better). Site screening uses a 2° horizon and 30-minute steps; the chosen
 * alternative is re-evaluated at full resolution when the user opens it.
 */
import type { Ephemeris } from './ephemeris';
import { computeHorizon } from './horizon';
import { slopeAt } from './landing';
import { hours, powerCommsReasons, simulate, stepMinutesFor, type Limits, type MissionResult, type Reason, type Spacecraft } from './mission';
import { distanceAz, offset, toLatLon, toXY, type LatLon } from './polar';
import type { PolarTerrain } from './terrain';

export interface SiteAlternative {
  readonly site: LatLon;
  readonly distanceM: number;
  readonly azDeg: number;
  readonly darkH: number;
  readonly blackoutH: number;
  readonly sunPct: number;
  readonly earthPct: number;
  readonly minSocPct: number;
  readonly slopeDeg: number;
  /** True when every rule passes for this spacecraft and these dates. */
  readonly passes: boolean;
  /** Rules this candidate still breaks (empty when it passes). */
  readonly reasons: readonly Reason[];
  /** 0 when passing; otherwise 1000 × broken rules + how far over each limit (lower is better). */
  readonly score: number;
}

export interface DateAlternative {
  readonly shiftDays: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly darkH: number;
  readonly blackoutH: number;
  readonly minSocPct: number;
  readonly passes: boolean;
  readonly reasons: readonly Reason[];
  readonly score: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 0 for a passing plan; otherwise 1000 per broken rule plus the ratio by which each limit is exceeded. */
export function failureScore(reasons: readonly Reason[]): number {
  let s = 0;
  for (const r of reasons) {
    s += 1000;
    if (r.code === 'battery') s += r.batteryH > 0 ? r.darkH / r.batteryH : 100;
    else if (r.code === 'blackout') s += r.maxH > 0 ? r.blackoutH / r.maxH : 100;
    else if (r.code === 'slope') s += r.maxDeg > 0 ? r.slopeDeg / r.maxDeg : 100;
  }
  return s;
}

/** The search covers this radius around the chosen site, automatically. */
export const ALT_RADIUS_KM = 100;
const RINGS_KM = [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 55, 70, 85, 100];

/** Ring radii (km) up to `radiusKm`: dense near the site, sparser far away (spacing never shrinks). */
export function searchRings(radiusKm: number): number[] {
  const r = RINGS_KM.filter((x) => x < radiusKm - 1e-9);
  r.push(radiusKm);
  return r;
}

/** Screening step: at least 30 min, coarser for long missions. */
function screenStep(startMs: number, endMs: number): number {
  return Math.max(30, stepMinutesFor(endMs - startMs));
}

export async function searchSites(
  eph: Ephemeris, t: PolarTerrain, center: LatLon, radiusKm: number, startMs: number, endMs: number,
  sc: Spacecraft, lim: Limits, want = 5, signal?: AbortSignal,
  onProgress?: (best: SiteAlternative[]) => void,
): Promise<SiteAlternative[]> {
  const c = toXY(center);
  // 40 m detail only near the site; farther candidates use the 240 m grid (loading all tiles would be ~70 MB).
  await t.ensureDetail(c, Math.min(radiusKm, 20) * 1000 + 13_000);
  const stepMin = screenStep(startMs, endMs);
  const found: SiteAlternative[] = [];
  const near: SiteAlternative[] = [];
  const best = () => [...found, ...[...near].sort((a, b) => a.score - b.score || a.distanceM - b.distanceM)].slice(0, want);
  const rings = searchRings(radiusKm);
  for (let ri = 0; ri < rings.length && found.length < want; ri++) {
    const r = rings[ri]!;
    const spacing = r - (rings[ri - 1] ?? 0);
    const nAz = Math.max(8, Math.min(24, Math.round((2 * Math.PI * r) / spacing)));
    const ring: SiteAlternative[] = [];
    for (let k = 0; k < nAz; k++) {
      await tick();
      if (signal?.aborted) return found;
      const az = (360 * k) / nAz;
      const q = offset(c, az, r * 1000);
      const slope = slopeAt(t, q, 80);
      if (!Number.isFinite(slope)) continue;
      const site = toLatLon(q);
      const hz = computeHorizon(t, q, sc.mastM, 2);
      const res = simulate(eph, hz, site, startMs, endMs, sc, lim, stepMin);
      if ('kind' in res) continue;
      const reasons: Reason[] = [];
      if (slope > lim.maxSlopeDeg) reasons.push({ code: 'slope', slopeDeg: slope, maxDeg: lim.maxSlopeDeg });
      reasons.push(...powerCommsReasons(res, lim));
      const da = distanceAz(center, site);
      const alt: SiteAlternative = {
        site, distanceM: da.m, azDeg: da.az, darkH: hours(res.longestDark), blackoutH: hours(res.longestBlackout),
        sunPct: res.sunVisiblePct, earthPct: res.earthVisiblePct, minSocPct: res.minSocPct, slopeDeg: slope,
        passes: reasons.length === 0, reasons, score: failureScore(reasons),
      };
      (alt.passes ? ring : near).push(alt);
    }
    ring.sort((a, b) => b.minSocPct - a.minSocPct);
    found.push(...ring.slice(0, want - found.length));
    onProgress?.(best());
  }
  return best();
}

export async function searchDates(
  eph: Ephemeris, t: PolarTerrain, site: LatLon, startMs: number, endMs: number, windowDays: number,
  sc: Spacecraft, lim: Limits, want = 4, signal?: AbortSignal,
): Promise<DateAlternative[]> {
  const hz = computeHorizon(t, toXY(site), sc.mastM, 1);
  const pass: DateAlternative[] = [];
  const fail: DateAlternative[] = [];
  const DAY = 86_400_000;
  const stepMin = screenStep(startMs, endMs);
  for (let k = 1; k <= windowDays && pass.length < want; k++) {
    for (const s of [k, -k]) {
      if (k % 4 === 0 || k < 4) await tick();
      if (signal?.aborted) return pass;
      const res = simulate(eph, hz, site, startMs + s * DAY, endMs + s * DAY, sc, lim, stepMin);
      if ('kind' in res) continue;
      const reasons = powerCommsReasons(res, lim);
      const alt: DateAlternative = { shiftDays: s, startMs: startMs + s * DAY, endMs: endMs + s * DAY, darkH: hours(res.longestDark),
        blackoutH: hours(res.longestBlackout), minSocPct: res.minSocPct, passes: reasons.length === 0, reasons, score: failureScore(reasons) };
      (alt.passes ? pass : fail).push(alt);
    }
  }
  fail.sort((a, b) => a.score - b.score || Math.abs(a.shiftDays) - Math.abs(b.shiftDays));
  return [...pass, ...fail].slice(0, want);
}

export type { MissionResult };
