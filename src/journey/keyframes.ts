/**
 * Journey maths without Three.js: selenographic vectors, Horizons lighting at the Journey date, and the scroll keyframes
 * (chapter 04 §4, with the rulings in the ledger: horizon cy, Descent R, lon 0 at the Handoff).
 */
import type { EphemerisFile } from '../planner/ephemeris';

export type Vec3 = [number, number, number];
const D = Math.PI / 180;

/**
 * Unit vector of (lat, east lon) in the Moon frame used by the scene. It matches Three.js SphereGeometry UVs with an
 * equirectangular map centred on 0° longitude: +X = (0°, 0°), +Y = north pole, −Z = 90° E.
 */
export function lonLatToVec3(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * D, lo = lonDeg * D;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/** Rotation that turns point (lat, lon) toward +Z with north up: R = Rx(lat) · Ry(−90° − lon). Applied to v. */
export function faceRotate(v: Vec3, latDeg: number, lonDeg: number): Vec3 {
  const a = (-90 - lonDeg) * D, b = latDeg * D;
  const x1 = v[0] * Math.cos(a) + v[2] * Math.sin(a), z1 = -v[0] * Math.sin(a) + v[2] * Math.cos(a);
  return [x1, v[1] * Math.cos(b) - z1 * Math.sin(b), v[1] * Math.sin(b) + z1 * Math.cos(b)];
}

/** Lighting date of the Journey (05 §4; chosen by a ±20-day scan, see CHANGELOG). */
export const JOURNEY_DATE = '2027-01-27T04:00:00Z';

/** Sub-solar and sub-Earth unit vectors at a time, linearly interpolated between the hourly Horizons rows. */
export function bodyDirs(f: EphemerisFile, iso: string): { sun: Vec3; earth: Vec3; earthLitFraction: number } {
  const t0 = Date.parse(f.startUtc.endsWith('Z') ? f.startUtc : `${f.startUtc}Z`);
  const x = (Date.parse(iso) - t0) / (f.stepHours * 3_600_000);
  const i = Math.max(0, Math.min(f.count - 2, Math.floor(x)));
  const w = x - i;
  const lerpLon = (a: number, b: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * w;
  const sun = lonLatToVec3(f.sunLat[i]! * (1 - w) + f.sunLat[i + 1]! * w, lerpLon(f.sunLon[i]!, f.sunLon[i + 1]!));
  const earth = lonLatToVec3(f.earthLat[i]! * (1 - w) + f.earthLat[i + 1]! * w, lerpLon(f.earthLon[i]!, f.earthLon[i + 1]!));
  // Fraction of Earth's disc lit as seen from the Moon: 0 when the Sun is behind Earth, 1 when opposite.
  const earthLitFraction = (1 - (sun[0] * earth[0] + sun[1] * earth[1] + sun[2] * earth[2])) / 2;
  return { sun, earth, earthLitFraction };
}

export interface SceneState {
  cx: number; cy: number; R: number; lon: number; lat: number; roll: number;
  ring: number; trace: number; hill: number; artemis: number; dim: number;
}
type Key = { p: number; ease?: string } & SceneState;

const K = (p: number, cx: number, cy: number, R: number, lon: number, lat: number, ring: number, trace: number, hill: number, artemis: number, dim: number, ease?: string): Key =>
  ({ p, cx, cy, R, lon, lat, roll: 0, ring, trace, hill, artemis, dim, ...(ease ? { ease } : {}) });

/** Desktop keyframes. `ease` is the ease INTO that key. */
export const KEYS: readonly Key[] = [
  K(0.0, 0.4, 0.0, 0.95, -8, -6, 0, 0, 0, 0, 0),
  K(0.12, 0.4, 0.0, 0.95, 4, -8, 0, 0, 0, 0, 0),
  K(0.2, 0.22, 0.02, 0.36, 18, -22, 1, 0, 0, 0, 0),
  K(0.33, 0.42, -0.04, 0.3, 30, -48, 1, 0, 0, 0, 0),
  K(0.4, 0.05, -0.65, 1.3, 40, -70, 0.4, 0.6, 0, 0, 0, 'expo.inOut'),
  K(0.48, 0, -5.9, 2.4, 45, -90, 0, 1, 0, 0, 0, 'expo.inOut'),
  K(0.6, 0, -5.9, 2.4, 75, -90, 0, 1, 0, 0, 0),
  K(0.68, 0, -1.6, 2.6, 60, -90, 0, 0, 0.4, 0, 0),
  K(0.76, 0, 0, 2.9, 25, -90, 0, 0, 1, 1, 0),
  K(0.86, 0, 0, 3.0, 0, -90, 0, 0, 1, 1, 0),
  K(1.0, 0, 0, 3.4, 0, -90, 0, 0, 1, 1, 0.88),
];

/** Portrait phones: Moon centred, a little lower in the hero, smaller (04 §4 "Mobile"). */
export function keysFor(portrait: boolean, rtl: boolean): Key[] {
  return KEYS.map((k) => {
    let { cx, cy, R } = k;
    if (portrait) {
      cx = 0;
      if (k.p <= 0.12) { cy = 0.3; R = k.R * 0.7; } else if (k.p <= 0.33) { cy = 0.28; R = k.R * 0.9; }
    }
    return { ...k, cx: rtl ? -cx : cx, cy, R };
  });
}

export const FOV_DEG = 35;
const TAN = Math.tan((FOV_DEG / 2) * D);

/** Moon centre (camera at the origin looking −Z) and distance for a state: the disc spans R × viewport height. */
export function placeMoon(s: Pick<SceneState, 'cx' | 'cy' | 'R'>, aspect: number): Vec3 {
  const alpha = Math.atan(2 * s.R * TAN);
  const d = 1 / Math.sin(alpha);
  const dir: Vec3 = [s.cx * TAN * aspect, s.cy * TAN, -1];
  const n = Math.hypot(...dir);
  return [(dir[0] / n) * d, (dir[1] / n) * d, (dir[2] / n) * d];
}

/** Linear sample of the keyframes at progress p (tests and the static fallback; the live Journey eases with GSAP). */
export function sampleAt(keys: readonly Key[], p: number): SceneState {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.p < p) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const w = Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p)));
  const out = {} as SceneState;
  for (const k of ['cx', 'cy', 'R', 'lon', 'lat', 'roll', 'ring', 'trace', 'hill', 'artemis', 'dim'] as const) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}

/** Scene ranges (04 §5). */
export const SCENES: readonly [number, number][] = [[0, 0.12], [0.12, 0.33], [0.33, 0.48], [0.48, 0.68], [0.68, 0.86], [0.86, 1]];
export function sceneAt(p: number): number {
  const i = SCENES.findIndex(([, e]) => p < e);
  return i < 0 ? SCENES.length - 1 : i;
}
