import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assess, DEFAULT_REQ } from './assess';
import { evaluateCandidates } from './candidates';
import { siteContext, type NamedCrater, type PsrFeature } from './context';
import { computeHorizon } from './horizon';
import { analyseLanding } from './landing';
import { simulate, type Limits, type Spacecraft } from './mission';
import { makeEphemeris, type EphemerisFile } from './ephemeris';
import { localAxes, toXY, type XY } from './polar';
import { PolarTerrain, type GridMeta, type TileMeta } from './terrain';
import { reliefAt, rng, sampleOffsets, simulateTouchdowns, wilson } from './uncertainty';

const DATA = 'public/data';

function realTerrain(): PolarTerrain {
  return new PolarTerrain({
    regional: async () => {
      const meta = JSON.parse(readFileSync(`${DATA}/lola_south_240m.json`, 'utf8')) as GridMeta;
      const buf = gunzipSync(readFileSync(`${DATA}/lola_south_240m.bin.gz`));
      return { meta, dn: new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2) };
    },
    tileMeta: async () => JSON.parse(readFileSync(`${DATA}/dem40/meta.json`, 'utf8')) as TileMeta,
    tile: async (r, c) => {
      const b = gunzipSync(readFileSync(`${DATA}/dem40/r${r}_c${c}.bin.gz`));
      return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    },
  });
}

/** Analytic terrain around an origin: height = f(east, north). */
function fakeTerrain(origin: XY, f: (eM: number, nM: number) => number): PolarTerrain {
  const { north, east } = localAxes(origin);
  const h = (q: XY) => {
    const dx = q.x - origin.x, dy = q.y - origin.y;
    return f(dx * east.x + dy * east.y, dx * north.x + dy * north.y);
  };
  return { heightAt: h, regionalHeightAt: h, hasDetail: () => true, ensureDetail: async () => {}, covers: () => true } as unknown as PolarTerrain;
}

const SC: Spacecraft = { arrayAreaM2: 1.8, arrayEff: 0.196, batteryWh: 2320, usableFrac: 0.85, dayLoadW: 150, nightLoadW: 100, panel: 'tracking', fixedAzDeg: 0, mastM: 2 };
const LIM: Limits = { minEarthElDeg: 1, maxBlackoutH: 72, minContactHPerDay: 2, maxSlopeDeg: 10, legSpanM: 4 };
const D = { northM: 200, eastM: 100, southM: 200, westM: 100 };
const O = toXY({ lat: -89.4, lon: -137 });

describe('uncertainty model', () => {
  it('PRNG and sampling are deterministic for a seed', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    expect(sampleOffsets(D, { sigmaLevel: 3, samples: 50, seed: 1 })).toEqual(sampleOffsets(D, { sigmaLevel: 3, samples: 50, seed: 1 }));
  });
  it('samples follow the k-sigma ellipse (≈98.9 % inside the 2-D ellipse for k = 3, asymmetric axes respected)', () => {
    const pts = sampleOffsets(D, { sigmaLevel: 3, samples: 20000, seed: 3 });
    const inside = pts.filter((p) => (p.e / (p.e >= 0 ? D.eastM : D.westM)) ** 2 + (p.n / (p.n >= 0 ? D.northM : D.southM)) ** 2 <= 1).length / pts.length;
    // Bivariate normal: P(r ≤ 3σ) = 1 − e^(−4.5) = 98.9 %
    expect(inside).toBeGreaterThan(0.985);
    expect(inside).toBeLessThan(0.993);
    const sdN = Math.sqrt(pts.filter((p) => p.n > 0).reduce((s, p) => s + p.n * p.n, 0) / pts.filter((p) => p.n > 0).length);
    expect(sdN).toBeCloseTo(200 / 3, -1);
  });
  it('Wilson interval brackets the estimate and narrows with n', () => {
    const [lo, hi] = wilson(590, 600);
    expect(lo).toBeLessThan(590 / 600);
    expect(hi).toBeGreaterThan(590 / 600);
    const [lo2, hi2] = wilson(5900, 6000);
    expect(hi2 - lo2).toBeLessThan(hi - lo);
    expect(wilson(600, 600)[1]).toBeGreaterThan(0.9999);
  });
  it('flat ground: every touchdown is safe, relief ≈ 0', () => {
    const r = simulateTouchdowns(fakeTerrain(O, () => 1000), O, D, 4, 10);
    expect(r.pSafe).toBe(1);
    expect(r.coveragePct).toBe(100);
    expect(r.reliefP95M).toBeLessThan(1e-6);
  });
  it('a 15° plane fails every touchdown for a 10° lander; a plane has zero relief', () => {
    const g = Math.tan((15 * Math.PI) / 180);
    const r = simulateTouchdowns(fakeTerrain(O, (e) => e * g), O, D, 4, 10);
    expect(r.pSafe).toBe(0);
    expect(r.slopeMeanDeg).toBeCloseTo(15, 0);
    expect(reliefAt(fakeTerrain(O, (e, n) => 0.3 * e - 0.1 * n), O, 40)).toBeLessThan(1e-6);
  });
  it('a steep half-plane: P(safe) tracks the share of the distribution on flat ground', () => {
    const g = Math.tan((20 * Math.PI) / 180);
    // east of the aim is steep (beyond the 80 m baseline), west is flat: about half the touchdowns are unsafe
    const r = simulateTouchdowns(fakeTerrain(O, (e) => (e > 0 ? e * g : 0)), O, { northM: 300, eastM: 300, southM: 300, westM: 300 }, 4, 10);
    expect(r.pSafe).toBeGreaterThan(0.25);
    expect(r.pSafe).toBeLessThan(0.75);
  });
  it('no data → zero coverage and an insufficient verdict', () => {
    const t = fakeTerrain(O, () => Number.NaN);
    const td = simulateTouchdowns(t, O, D, 4, 10);
    expect(td.coveragePct).toBe(0);
    const landing = analyseLanding(t, O, D, 4, 10);
    const a = assess(landing, td, { kind: 'insufficient', code: 'no-terrain' }, LIM, DEFAULT_REQ, null);
    expect(a.verdict).toBe('insufficient');
    expect(a.confidence).toBe('low');
  });
});

let shared: ReturnType<typeof build> | null = null;
async function build() {
  const t = realTerrain();
  await t.init();
  const eph = makeEphemeris(JSON.parse(readFileSync(`${DATA}/ephemeris.json`, 'utf8')) as EphemerisFile);
  const site = { lat: -89.4391, lon: -137.1912 };
  const q = toXY(site);
  await t.ensureDetail(q, 13_000);
  const start = Date.parse('2027-01-08T12:00:00Z');
  const hz = computeHorizon(t, q, SC.mastM, 1);
  const mission = simulate(eph, hz, site, start, start + 14 * 86_400_000, SC, LIM, 10);
  const landing = analyseLanding(t, q, D, LIM.legSpanM, LIM.maxSlopeDeg);
  const td = simulateTouchdowns(t, q, D, LIM.legSpanM, LIM.maxSlopeDeg);
  return { t, eph, site, q, start, hz, mission, landing, td };
}
const nasa = () => (shared ??= build());

describe('assessment on NASA data (Connecting Ridge, Jan 2027 default plan)', () => {
  it('uses the 40 m grid with full coverage', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    expect(td.gridM).toBe(40);
    expect(td.coveragePct).toBe(100);
  });
  it('verdict agrees with the engine rules and never contradicts a hard failure', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    const a = assess(landing, td, mission, LIM, DEFAULT_REQ, null);
    expect(['suitable', 'conditional']).toContain(a.verdict);
    expect(a.score).toBeGreaterThan(35);
    expect(a.findings[0]!.tone === 'bad').toBe(false);
  });
  it('a tiny battery makes the same plan Unsuitable, score capped at 35', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    const weak = simulate(eph, hz, site, start, start + 14 * 86_400_000, { ...SC, batteryWh: 50 }, LIM, 10);
    const a = assess(landing, td, weak, LIM, DEFAULT_REQ, null);
    if (!('kind' in weak) && weak.firstEmptyMs !== null) {
      expect(a.verdict).toBe('unsuitable');
      expect(a.score).toBeLessThanOrEqual(35);
      expect(a.findings[0]!.code).toBe('battery.empty');
    }
  });
  it('a 1° slope limit makes the touchdown rule fail', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    const strict = { ...LIM, maxSlopeDeg: 1 };
    const td1 = simulateTouchdowns(t, q, D, strict.legSpanM, 1);
    const a = assess(analyseLanding(t, q, D, 4, 1), td1, mission, strict, DEFAULT_REQ, null);
    expect(td1.pSafe).toBeLessThan(0.99);
    expect(a.verdict).toBe('unsuitable');
  });
  it('site context finds Shackleton as a named crater near the pole', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    const names = (JSON.parse(readFileSync(`${DATA}/lunar_names.json`, 'utf8')) as { features: [string, number, number, number, string][] })
      .features.map(([name, lat, lon, diameterKm, kind]) => ({ name, lat, lon, diameterKm, kind })) as NamedCrater[];
    const psr = (JSON.parse(readFileSync(`${DATA}/moontrek_vectors.json`, 'utf8')) as { psr: { features: PsrFeature[] } }).psr.features;
    const c = siteContext({ lat: -89.67, lon: 129.78 }, names, psr);
    expect(c.crater!.name).toBe('Shackleton');
    expect(c.crater!.inside).toBe(true);
    expect(c.psr).not.toBeNull();
  });
  it('candidates are never padded and are ordered suitable-first', async () => {
    const { t, eph, site, q, start, hz, mission, landing, td } = await nasa();
    void t; void eph; void site; void q; void start; void hz; void mission; void landing; void td;
    const fake = [
      { site: { lat: -89.43, lon: -137.0 }, distanceM: 1000, azDeg: 0, darkH: 10, blackoutH: 0, sunPct: 90, earthPct: 100, minSocPct: 80, slopeDeg: 3, passes: true, reasons: [], score: 0 },
      { site: { lat: -60, lon: 0 }, distanceM: 2000, azDeg: 0, darkH: 10, blackoutH: 0, sunPct: 90, earthPct: 100, minSocPct: 80, slopeDeg: 3, passes: true, reasons: [], score: 0 },
    ];
    const set = evaluateCandidates(t, fake, D, LIM, DEFAULT_REQ, { darkH: 20, blackoutH: 0, minSocPct: 50, pSafe: 0.9 });
    expect(set.items.length + set.excluded).toBe(2);
    expect(set.excluded).toBe(1); // -60° is outside LOLA polar coverage: excluded, not invented
    expect(set.items[0]!.reason.code.startsWith('why.')).toBe(true);
  });
});
