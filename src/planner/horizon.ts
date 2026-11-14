/**
 * Terrain horizon around a site from NASA LOLA heights (airless Moon: no refraction).
 * For each azimuth: max over ground distance d of atan((h(d) − d²/2R − h_obs) / d),
 * with h_obs = ground height + panel/antenna height. Near field 0–12 km from the 40 m grid (20 m steps),
 * far field 12–150 km from the 240 m grid. Beyond 150 km the curvature drop (≥ 6.5 km) hides everything
 * the polar terrain can raise.
 */
import { localAxes, MOON_R_M, scaleAt, type XY } from './polar';
import type { PolarTerrain } from './terrain';

export interface Horizon {
  readonly stepDeg: number;
  readonly el: Float32Array;
  /** Observer height above the reference sphere (m). */
  readonly observerM: number;
  readonly groundM: number;
}

const D = Math.PI / 180;
const NEAR_M = 12_000;
const FAR_M = 150_000;

export function computeHorizon(t: PolarTerrain, site: XY, mastM: number, stepDeg = 1): Horizon {
  const ground = t.heightAt(site);
  const h0 = ground + mastM;
  const { north, east } = localAxes(site);
  const n = Math.round(360 / stepDeg);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * stepDeg * D;
    const dx = Math.cos(a) * north.x + Math.sin(a) * east.x;
    const dy = Math.cos(a) * north.y + Math.sin(a) * east.y;
    let best = -90;
    let d = 20;
    while (d <= FAR_M) {
      const k = scaleAt(site);
      const q = { x: site.x + dx * d * k, y: site.y + dy * d * k };
      const h = d <= NEAR_M ? t.heightAt(q) : t.regionalHeightAt(q);
      if (!Number.isFinite(h)) break;
      const e = Math.atan((h - (d * d) / (2 * MOON_R_M) - h0) / d) / D;
      if (e > best) best = e;
      d += d < NEAR_M ? 20 : d < 40_000 ? 120 : 240;
    }
    out[i] = best;
  }
  return { stepDeg, el: out, observerM: h0, groundM: ground };
}

export function horizonAt(h: Horizon, azDeg: number): number {
  const n = h.el.length;
  const a = ((((azDeg % 360) + 360) % 360) / h.stepDeg);
  const i0 = Math.floor(a) % n;
  const f = a - Math.floor(a);
  return h.el[i0]! * (1 - f) + h.el[(i0 + 1) % n]! * f;
}
