/**
 * Unified landing assessment: Suitable / Conditional / Unsuitable, a 0–100 decision index, a confidence level and
 * the ordered findings that explain it. Every number comes from the engine (LOLA terrain, JPL Horizons geometry,
 * the user's spacecraft) — nothing here is measured or invented; this module only combines and explains.
 *
 * Rules (hard → Unsuitable):
 *   - battery empties during the mission;
 *   - longest Earth blackout exceeds the mission limit;
 *   - modelled P(touchdown on assessed-safe slope) is below the mission requirement with 95 % confidence
 *     (Wilson upper bound < requirement).
 * Conditional when no hard rule fails but any of:
 *   - the P(safe) interval straddles the requirement;
 *   - a point inside the k-sigma ellipse exceeds the slope limit (worst case) while P(safe) still passes;
 *   - thin margins: minimum battery < 20 % or blackout > 75 % of the limit;
 *   - inside an (approximate) permanently shadowed region.
 * The index is a weighted mean (terrain 45, power 35, comms 20), capped at 35 when a hard rule fails.
 * It ranks options; it is not a probability of mission success.
 */
import type { SiteContext } from './context';
import type { LandingResult } from './landing';
import { hours, type Insufficient, type Limits, type MissionResult } from './mission';
import type { TouchdownResult } from './uncertainty';

export interface Requirements {
  /** Required probability that touchdown lands on slope within the limit (0–1). */
  readonly minPSafe: number;
  /** Dispersion values are k-sigma. */
  readonly sigmaLevel: number;
  /** Monte Carlo sample count. */
  readonly samples: number;
}
export const DEFAULT_REQ: Requirements = { minPSafe: 0.99, sigmaLevel: 3, samples: 600 };

export type Verdict = 'suitable' | 'conditional' | 'unsuitable' | 'insufficient';
export type Confidence = 'high' | 'medium' | 'low';
export type FactorId = 'terrain' | 'power' | 'comms' | 'thermal';
export type FactorStatus = 'pass' | 'watch' | 'fail' | 'na';
export interface FactorScore { readonly id: FactorId; readonly score: number | null; readonly status: FactorStatus }
export type Tone = 'ok' | 'warn' | 'bad' | 'info';
export interface Finding { readonly tone: Tone; readonly code: string; readonly p: Readonly<Record<string, number | string>> }

export interface Assessment {
  readonly verdict: Verdict;
  readonly score: number;
  readonly confidence: Confidence;
  readonly coveragePct: number;
  readonly factors: readonly FactorScore[];
  readonly findings: readonly Finding[];
}

const RANK: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, info: 3 };
const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));

export function assess(
  landing: LandingResult, td: TouchdownResult, mission: MissionResult | Insufficient, lim: Limits, req: Requirements, ctx: SiteContext | null,
): Assessment {
  const f: Finding[] = [];
  let hard = false;
  let watch = false;

  // ---- terrain / footprint
  const [lo, hi] = td.ci95;
  let terrain: FactorStatus;
  if (td.valid === 0) {
    terrain = 'na';
    f.push({ tone: 'bad', code: 'td.nodata', p: {} });
  } else if (hi < req.minPSafe) {
    terrain = 'fail'; hard = true;
    f.push({ tone: 'bad', code: 'td.low', p: { p: td.pSafe * 100, lo: lo * 100, hi: hi * 100, req: req.minPSafe * 100, max: lim.maxSlopeDeg } });
  } else if (lo < req.minPSafe) {
    terrain = 'watch'; watch = true;
    f.push({ tone: 'warn', code: 'td.uncertain', p: { p: td.pSafe * 100, lo: lo * 100, hi: hi * 100, req: req.minPSafe * 100 } });
  } else {
    terrain = 'pass';
    f.push({ tone: 'ok', code: td.safe === td.valid ? 'td.all' : 'td.ok', p: { p: td.pSafe * 100, lo: lo * 100, req: req.minPSafe * 100, n: td.valid } });
  }
  if (terrain !== 'fail' && landing.samples > 0 && landing.maxSlopeDeg > lim.maxSlopeDeg) {
    watch = true;
    if (terrain === 'pass') terrain = 'watch';
    f.push({ tone: 'warn', code: 'worst.slope', p: { s: landing.maxSlopeDeg, max: lim.maxSlopeDeg, pct: landing.unsafePct } });
  }
  const terrainScore = td.valid ? clamp(100 * td.pSafe) : null;

  // ---- power / illumination and comms
  let power: FactorStatus = 'na', comms: FactorStatus = 'na';
  let powerScore: number | null = null, commsScore: number | null = null;
  if (!('kind' in mission)) {
    const darkH = hours(mission.longestDark);
    if (mission.firstEmptyMs !== null) {
      power = 'fail'; hard = true; powerScore = 0;
      f.push({ tone: 'bad', code: 'battery.empty', p: { dark: darkH, batt: mission.batteryHours, t: mission.firstEmptyMs } });
    } else {
      powerScore = clamp(50 + mission.minSocPct / 2);
      if (mission.minSocPct < 20) { power = 'watch'; watch = true; f.push({ tone: 'warn', code: 'battery.thin', p: { soc: mission.minSocPct, dark: darkH } }); }
      else { power = 'pass'; f.push({ tone: 'ok', code: 'battery.ok', p: { soc: mission.minSocPct, sun: mission.sunVisiblePct, dark: darkH } }); }
    }
    const bH = hours(mission.longestBlackout);
    if (bH > lim.maxBlackoutH) {
      comms = 'fail'; hard = true; commsScore = 0;
      f.push({ tone: 'bad', code: 'blackout.fail', p: { h: bH, max: lim.maxBlackoutH } });
    } else {
      commsScore = clamp(100 * (1 - (0.5 * bH) / Math.max(1, lim.maxBlackoutH)));
      if (bH > 0.75 * lim.maxBlackoutH) { comms = 'watch'; watch = true; f.push({ tone: 'warn', code: 'blackout.thin', p: { h: bH, max: lim.maxBlackoutH } }); }
      else { comms = 'pass'; f.push({ tone: 'ok', code: 'comms.ok', p: { pct: mission.earthVisiblePct, h: bH } }); }
    }
  }

  // ---- context and data
  if (ctx?.psr?.inside) { watch = true; f.push({ tone: 'warn', code: 'psr.inside', p: { name: ctx.psr.name } }); }
  else if (ctx?.psr && ctx.psr.edgeKm < 2) f.push({ tone: 'info', code: 'psr.near', p: { name: ctx.psr.name, km: ctx.psr.edgeKm } });
  if (ctx?.crater && ctx.crater.rimKm < 3) f.push({ tone: 'info', code: ctx.crater.inside ? 'crater.inside' : 'crater.rim', p: { name: ctx.crater.name, km: ctx.crater.rimKm, d: ctx.crater.diameterKm } });
  if (td.gridM > 40) f.push({ tone: 'info', code: 'data.240', p: { b: td.baselineM } });
  if (td.coveragePct < 99.5) f.push({ tone: 'info', code: 'data.gaps', p: { pct: 100 - td.coveragePct } });
  f.push({ tone: 'info', code: 'thermal.na', p: {} });
  f.push({ tone: 'info', code: 'boulders.na', p: {} });

  // ---- verdict, index, confidence
  const insufficient = 'kind' in mission || td.valid === 0;
  const verdict: Verdict = insufficient ? 'insufficient' : hard ? 'unsuitable' : watch ? 'conditional' : 'suitable';
  const parts: [number | null, number][] = [[terrainScore, 45], [powerScore, 35], [commsScore, 20]];
  let num = 0, den = 0;
  for (const [s, w] of parts) if (s !== null) { num += s * w; den += w; }
  let score = den ? Math.round(num / den) : 0;
  if (hard) score = Math.min(score, 35);
  let confidence: Confidence = 'high';
  if (td.gridM > 40 || td.coveragePct < 95 || hi - lo > 0.1) confidence = 'medium';
  if (insufficient || td.coveragePct < 80) confidence = 'low';

  f.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  return {
    verdict, score, confidence, coveragePct: td.coveragePct,
    factors: [
      { id: 'terrain', score: terrainScore, status: terrain },
      { id: 'power', score: powerScore, status: power },
      { id: 'comms', score: commsScore, status: comms },
      { id: 'thermal', score: null, status: 'na' },
    ],
    findings: f,
  };
}
