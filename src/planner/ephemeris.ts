/**
 * Sun and Earth positions from NASA JPL Horizons (public/data/ephemeris.json, built by scripts/fetch_horizons.py).
 * Hourly sub-solar / sub-Earth points on the Moon (MOON_ME frame) plus distances. Topocentric azimuth/elevation
 * for any site is computed with full parallax. scripts/verify_horizons.py checks this exact maths against direct
 * topocentric Horizons queries (Sun ≤ 0.0002°, Earth ≤ 0.006° over 816 comparisons).
 */
import { MOON_R_M, type LatLon } from './polar';

export interface EphemerisFile {
  readonly startUtc: string;
  readonly stepHours: number;
  readonly count: number;
  readonly earthLon: readonly number[];
  readonly earthLat: readonly number[];
  readonly earthKm: readonly number[];
  readonly sunLon: readonly number[];
  readonly sunLat: readonly number[];
  readonly sunKm: readonly number[];
}

export interface Ephemeris {
  readonly startMs: number;
  readonly endMs: number;
  readonly stepMs: number;
  readonly file: EphemerisFile;
}

export interface AzEl {
  /** Azimuth, degrees clockwise from local north. */
  readonly az: number;
  /** Elevation above the local horizontal plane (not the terrain), degrees. */
  readonly el: number;
  /** Distance from the site, km. */
  readonly km: number;
}

const D = Math.PI / 180;
export const SUN_RADIUS_KM = 695_700;

export function makeEphemeris(file: EphemerisFile): Ephemeris {
  const startMs = Date.parse(file.startUtc);
  const stepMs = file.stepHours * 3_600_000;
  return { startMs, stepMs, endMs: startMs + (file.count - 1) * stepMs, file };
}

export function covers(e: Ephemeris, tMs: number): boolean {
  return tMs >= e.startMs && tMs <= e.endMs;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}
function lerpLon(a: number, b: number, f: number): number {
  const d = ((((b - a + 540) % 360) + 360) % 360) - 180;
  return a + d * f;
}
function unit(latDeg: number, lonDeg: number): [number, number, number] {
  const la = latDeg * D;
  const lo = lonDeg * D;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Topocentric az/el of the Sun or Earth from a site at height hM above the reference sphere. */
export function azEl(e: Ephemeris, body: 'sun' | 'earth', site: LatLon, hM: number, tMs: number): AzEl {
  const pos = (tMs - e.startMs) / e.stepMs;
  const i = Math.max(0, Math.min(e.file.count - 2, Math.floor(pos)));
  const f = Math.max(0, Math.min(1, pos - i));
  const f0 = e.file;
  const lat = body === 'sun' ? lerp(f0.sunLat[i]!, f0.sunLat[i + 1]!, f) : lerp(f0.earthLat[i]!, f0.earthLat[i + 1]!, f);
  const lon = body === 'sun' ? lerpLon(f0.sunLon[i]!, f0.sunLon[i + 1]!, f) : lerpLon(f0.earthLon[i]!, f0.earthLon[i + 1]!, f);
  const dist = body === 'sun' ? lerp(f0.sunKm[i]!, f0.sunKm[i + 1]!, f) : lerp(f0.earthKm[i]!, f0.earthKm[i + 1]!, f);
  const b = unit(lat, lon).map((c) => c * dist);
  const r = MOON_R_M / 1000 + hM / 1000;
  const p = unit(site.lat, site.lon).map((c) => c * r);
  const d = [b[0]! - p[0]!, b[1]! - p[1]!, b[2]! - p[2]!];
  const n = Math.hypot(d[0]!, d[1]!, d[2]!);
  const u = [d[0]! / n, d[1]! / n, d[2]! / n];
  const la = site.lat * D;
  const lo = site.lon * D;
  const up = unit(site.lat, site.lon);
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const dot = (a: number[], v: number[]) => a[0]! * v[0]! + a[1]! * v[1]! + a[2]! * v[2]!;
  const el = Math.asin(Math.max(-1, Math.min(1, dot(u, up)))) / D;
  const az = ((Math.atan2(dot(u, east), dot(u, north)) / D) + 360) % 360;
  return { az, el, km: n };
}

/** Apparent solar disc radius (deg) at a distance in km. */
export function sunRadiusDeg(km: number): number {
  return Math.asin(SUN_RADIUS_KM / km) / D;
}

/** Fraction (0..1) of the solar disc above a horizon line, given centre margin m (deg) and disc radius r (deg). */
export function discFractionVisible(m: number, r: number): number {
  if (m >= r) return 1;
  if (m <= -r) return 0;
  const hidden = r * r * Math.acos(m / r) - m * Math.sqrt(r * r - m * m);
  return 1 - hidden / (Math.PI * r * r);
}
