/**
 * NASA LOLA south-pole heights in polar stereographic metres (see polar.ts).
 * - Regional grid: LDEM_75S_240M to 75°S (public/data/lola_south_240m.bin.gz).
 * - Detail grid: LDEM_85S_20M averaged to 40 m, 512×512 gzip tiles loaded on demand (public/data/dem40/).
 * heightAt() uses the 40 m grid wherever its tile is loaded, otherwise the 240 m grid. NaN outside coverage.
 * Heights are metres relative to the 1737.4 km reference sphere.
 */
import type { XY } from './polar';

export interface GridMeta {
  readonly size: number;
  readonly mapScaleM: number;
  readonly scalingFactorM: number;
  readonly originSample: number;
  readonly originLine: number;
  readonly signSample: number;
  readonly signLine: number;
  /** Northern edge of the analysed area (degrees, e.g. −75). */
  readonly minLatDeg?: number;
}
export interface TileMeta extends GridMeta {
  readonly tile: number;
  readonly tilesPerSide: number;
}

export interface TerrainLoaders {
  readonly regional: () => Promise<{ meta: GridMeta; dn: Int16Array }>;
  readonly tileMeta: () => Promise<TileMeta>;
  readonly tile: (row: number, col: number) => Promise<Int16Array>;
}

function bilinear(dn: Int16Array, n: number, s: number, l: number): number {
  if (s < 0 || l < 0 || s > n - 1 || l > n - 1) return Number.NaN;
  const s0 = Math.min(Math.floor(s), n - 2);
  const l0 = Math.min(Math.floor(l), n - 2);
  const fs = s - s0;
  const fl = l - l0;
  const i = l0 * n + s0;
  return ((dn[i]! * (1 - fs) + dn[i + 1]! * fs) * (1 - fl) + (dn[i + n]! * (1 - fs) + dn[i + n + 1]! * fs) * fl);
}

export class PolarTerrain {
  private regional: { meta: GridMeta; dn: Int16Array } | null = null;
  private tmeta: TileMeta | null = null;
  private readonly tiles = new Map<string, Int16Array | null>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly loaders: TerrainLoaders) {}

  async init(): Promise<void> {
    if (this.regional && this.tmeta) return;
    const [r, t] = await Promise.all([this.loaders.regional(), this.loaders.tileMeta()]);
    this.regional = r;
    this.tmeta = t;
  }

  get ready(): boolean {
    return this.regional !== null;
  }

  /** Northern limit of the analysed area (degrees). */
  get minLatDeg(): number {
    return this.regional?.meta.minLatDeg ?? -75;
  }

  /** True when the point is inside the regional (75°S) coverage. */
  covers(q: XY): boolean {
    return Number.isFinite(this.regionalHeight(q));
  }

  /** True when the 40 m detail grid covers the point (lat ≤ −85° area). */
  hasDetail(q: XY): boolean {
    const m = this.tmeta;
    if (!m) return false;
    const s = m.originSample + (m.signSample * q.x) / m.mapScaleM;
    const l = m.originLine + (m.signLine * q.y) / m.mapScaleM;
    return s >= 0 && l >= 0 && s <= m.size - 1 && l <= m.size - 1;
  }

  /** Load the 40 m tiles covering a square of half-width `halfM` around q. */
  async ensureDetail(q: XY, halfM: number): Promise<void> {
    const m = this.tmeta;
    if (!m) return;
    const s0 = m.originSample + (m.signSample * (q.x - halfM)) / m.mapScaleM;
    const s1 = m.originSample + (m.signSample * (q.x + halfM)) / m.mapScaleM;
    const l0 = m.originLine + (m.signLine * (q.y + halfM)) / m.mapScaleM;
    const l1 = m.originLine + (m.signLine * (q.y - halfM)) / m.mapScaleM;
    const jobs: Promise<void>[] = [];
    for (let r = Math.max(0, Math.floor(Math.min(l0, l1) / m.tile)); r <= Math.min(m.tilesPerSide - 1, Math.floor(Math.max(l0, l1) / m.tile)); r++) {
      for (let c = Math.max(0, Math.floor(Math.min(s0, s1) / m.tile)); c <= Math.min(m.tilesPerSide - 1, Math.floor(Math.max(s0, s1) / m.tile)); c++) {
        const key = `${r}_${c}`;
        if (this.tiles.has(key)) continue;
        let p = this.pending.get(key);
        if (!p) {
          p = this.loaders
            .tile(r, c)
            .then((d) => void this.tiles.set(key, d))
            .catch(() => void this.tiles.set(key, null));
          this.pending.set(key, p);
        }
        jobs.push(p);
      }
    }
    await Promise.all(jobs);
  }

  private regionalHeight(q: XY): number {
    const g = this.regional;
    if (!g) return Number.NaN;
    const m = g.meta;
    const s = m.originSample + (m.signSample * q.x) / m.mapScaleM;
    const l = m.originLine + (m.signLine * q.y) / m.mapScaleM;
    return bilinear(g.dn, m.size, s, l) * m.scalingFactorM;
  }

  private detailHeight(q: XY): number {
    const m = this.tmeta;
    if (!m) return Number.NaN;
    const s = m.originSample + (m.signSample * q.x) / m.mapScaleM;
    const l = m.originLine + (m.signLine * q.y) / m.mapScaleM;
    if (s < 0 || l < 0 || s > m.size - 1 || l > m.size - 1) return Number.NaN;
    const r = Math.floor(l / m.tile);
    const c = Math.floor(s / m.tile);
    const t = this.tiles.get(`${r}_${c}`);
    if (!t) return Number.NaN;
    const ls = l - r * m.tile;
    const ss = s - c * m.tile;
    if (ss > m.tile - 1 || ls > m.tile - 1) {
      // tile seam: fall back to nearest sample inside this tile
      return t[Math.min(m.tile - 1, Math.round(ls)) * m.tile + Math.min(m.tile - 1, Math.round(ss))]! * m.scalingFactorM;
    }
    return bilinear(t, m.tile, ss, ls) * m.scalingFactorM;
  }

  /** Best available height (m) at q, or NaN outside coverage. */
  heightAt(q: XY): number {
    const h = this.detailHeight(q);
    return Number.isFinite(h) ? h : this.regionalHeight(q);
  }

  /** Regional (240 m) height only: used for distant terrain in the horizon march. */
  regionalHeightAt(q: XY): number {
    return this.regionalHeight(q);
  }
}
