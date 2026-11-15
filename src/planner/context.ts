/**
 * Site context from catalogued features (not pass/fail rules):
 *  - nearest named crater rim (IAU Gazetteer, south of 60°S; only craters the IAU has named, so small
 *    unnamed craters are NOT in this list — the DEM slope/relief model covers terrain at 40/240 m);
 *  - permanently shadowed regions from NASA Moon Trek (each PSR is a point + area; we approximate it as a
 *    circle of equal area, so the "inside" test is approximate and labelled so).
 */
import { distanceAz, toLatLon, type LatLon } from './polar';

export interface NamedCrater { readonly name: string; readonly lat: number; readonly lon: number; readonly diameterKm: number; readonly kind: string }
export interface PsrFeature { readonly label: string; readonly point: readonly [number, number]; readonly areaKm2: number; readonly feature: string }

export interface CraterContext {
  readonly name: string;
  readonly diameterKm: number;
  /** Distance to the rim (km, ≥ 0) and whether the site is inside the rim. */
  readonly rimKm: number;
  readonly inside: boolean;
}
export interface PsrContext {
  readonly name: string;
  readonly areaKm2: number;
  /** Distance from the PSR's equal-area circle edge (km, 0 when inside). */
  readonly edgeKm: number;
  readonly inside: boolean;
}
export interface SiteContext {
  readonly crater: CraterContext | null;
  readonly psr: PsrContext | null;
}

export function siteContext(site: LatLon, names: readonly NamedCrater[], psrs: readonly PsrFeature[]): SiteContext {
  let crater: CraterContext | null = null;
  for (const c of names) {
    if (c.kind !== 'crater' || c.lat > -70) continue;
    const dKm = distanceAz(site, c).m / 1000;
    const r = c.diameterKm / 2;
    const rimKm = Math.abs(dKm - r);
    if (!crater || rimKm < crater.rimKm) crater = { name: c.name, diameterKm: c.diameterKm, rimKm, inside: dKm < r };
  }
  let psr: PsrContext | null = null;
  for (const p of psrs) {
    const ll = toLatLon({ x: p.point[0], y: p.point[1] });
    const dKm = distanceAz(site, ll).m / 1000;
    const r = Math.sqrt(p.areaKm2 / Math.PI);
    const edgeKm = Math.max(0, dKm - r);
    if (!psr || edgeKm < psr.edgeKm) psr = { name: p.feature || p.label, areaKm2: p.areaKm2, edgeKm, inside: dKm <= r };
  }
  return { crater, psr };
}
