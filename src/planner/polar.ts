/**
 * South polar stereographic projection on the IAU Moon sphere (R = 1737.4 km), centre −90°/0°.
 * Same convention as NASA LOLA polar products and NASA Moon Trek south-pole tiles:
 *   ρ = 2R·tan(π/4 + lat/2),  x = ρ·sin(lon),  y = ρ·cos(lon)   (metres; lon east-positive)
 * Local directions at a point: north (away from the pole) = (sin lon, cos lon), east = (cos lon, −sin lon).
 */
export const MOON_R_M = 1_737_400;
const D = Math.PI / 180;

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}
export interface XY {
  readonly x: number;
  readonly y: number;
}

export function toXY(p: LatLon): XY {
  const rho = 2 * MOON_R_M * Math.tan(Math.PI / 4 + (p.lat * D) / 2);
  return { x: rho * Math.sin(p.lon * D), y: rho * Math.cos(p.lon * D) };
}

export function toLatLon(q: XY): LatLon {
  const rho = Math.hypot(q.x, q.y);
  const lat = (2 * Math.atan(rho / (2 * MOON_R_M)) - Math.PI / 2) / D;
  const lon = rho === 0 ? 0 : Math.atan2(q.x, q.y) / D;
  return { lat, lon };
}

/** Map scale factor (map metres per ground metre) at a point. */
export function scaleAt(q: XY): number {
  const r2 = q.x * q.x + q.y * q.y;
  return 1 + r2 / (4 * MOON_R_M * MOON_R_M);
}

/** Unit vectors (map plane) for local north and east at a map point. At the pole north is taken as +y. */
export function localAxes(q: XY): { north: XY; east: XY } {
  const rho = Math.hypot(q.x, q.y);
  const n = rho < 1e-6 ? { x: 0, y: 1 } : { x: q.x / rho, y: q.y / rho };
  return { north: n, east: { x: n.y, y: -n.x } };
}

/** Move `groundM` metres on the ground from q along azimuth `azDeg` (clockwise from local north). */
export function offset(q: XY, azDeg: number, groundM: number): XY {
  const { north, east } = localAxes(q);
  const k = scaleAt(q);
  const s = Math.sin(azDeg * D);
  const c = Math.cos(azDeg * D);
  return { x: q.x + k * groundM * (c * north.x + s * east.x), y: q.y + k * groundM * (c * north.y + s * east.y) };
}

/** Ground distance (m) and azimuth (deg, clockwise from north at `a`) from a to b, great-circle. */
export function distanceAz(a: LatLon, b: LatLon): { m: number; az: number } {
  const la1 = a.lat * D;
  const la2 = b.lat * D;
  const dl = (b.lon - a.lon) * D;
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2;
  const m = 2 * MOON_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return { m, az: ((Math.atan2(y, x) / D) + 360) % 360 };
}
