/**
 * Five-alternative engine. Takes the nearby-site search (same dates, same spacecraft, same simulation as the
 * main plan — see alternatives.ts), re-evaluates each candidate's landing footprint with the Monte Carlo
 * touchdown model, applies the same verdict rules, and explains each candidate against the original plan.
 *
 * Evidence requirement: a candidate is shown only when ≥ 95 % of its touchdown samples have DEM coverage.
 * Candidates are never padded: if fewer than five meet the evidence requirement the list is shorter and the
 * caller explains why (`excluded`). Candidates that fail a rule are kept but labelled Unsuitable.
 */
import type { SiteAlternative } from './alternatives';
import type { Confidence, Finding, Requirements, Verdict } from './assess';
import type { Dispersion } from './landing';
import type { Limits } from './mission';
import { toXY } from './polar';
import type { PolarTerrain } from './terrain';
import { simulateTouchdowns, type TouchdownResult } from './uncertainty';

export interface Baseline { readonly darkH: number; readonly blackoutH: number; readonly minSocPct: number; readonly pSafe: number }

export interface Candidate {
  readonly alt: SiteAlternative;
  readonly td: TouchdownResult;
  readonly verdict: Verdict;
  readonly score: number;
  readonly confidence: Confidence;
  readonly pros: readonly Finding[];
  readonly cons: readonly Finding[];
  readonly reason: Finding;
}
export interface CandidateSet { readonly items: readonly Candidate[]; readonly excluded: number; readonly passing: number }

const ORDER: Record<Verdict, number> = { suitable: 0, conditional: 1, unsuitable: 2, insufficient: 3 };

export function evaluateCandidates(
  t: PolarTerrain, alts: readonly SiteAlternative[], d: Dispersion, lim: Limits, req: Requirements, base: Baseline | null, want = 5,
): CandidateSet {
  const items: Candidate[] = [];
  let excluded = 0;
  for (const alt of alts) {
    const td = simulateTouchdowns(t, toXY(alt.site), d, lim.legSpanM, lim.maxSlopeDeg, { sigmaLevel: req.sigmaLevel, samples: 300, seed: 7 });
    if (td.coveragePct < 95) { excluded++; continue; }
    const [lo, hi] = td.ci95;
    const hard = alt.reasons.some((r) => r.code !== 'slope') || hi < req.minPSafe;
    const watch = lo < req.minPSafe || alt.minSocPct < 20 || alt.blackoutH > 0.75 * lim.maxBlackoutH;
    const verdict: Verdict = hard ? 'unsuitable' : watch ? 'conditional' : 'suitable';
    const terrain = 100 * td.pSafe;
    const power = alt.reasons.some((r) => r.code === 'battery') ? 0 : Math.min(100, 50 + alt.minSocPct / 2);
    const comms = alt.reasons.some((r) => r.code === 'blackout') ? 0 : Math.max(0, 100 * (1 - (0.5 * alt.blackoutH) / Math.max(1, lim.maxBlackoutH)));
    let score = Math.round(0.45 * terrain + 0.35 * power + 0.2 * comms);
    if (hard) score = Math.min(score, 35);
    const confidence: Confidence = td.gridM > 40 || hi - lo > 0.1 ? 'medium' : 'high';

    const pros: Finding[] = [];
    const cons: Finding[] = [];
    if (base) {
      if (alt.darkH < base.darkH - 1) pros.push({ tone: 'ok', code: 'pro.dark', p: { h: base.darkH - alt.darkH } });
      else if (alt.darkH > base.darkH + 1) cons.push({ tone: 'warn', code: 'con.dark', p: { h: alt.darkH - base.darkH } });
      if (alt.blackoutH < base.blackoutH - 1) pros.push({ tone: 'ok', code: 'pro.blackout', p: { h: base.blackoutH - alt.blackoutH } });
      else if (alt.blackoutH > base.blackoutH + 1) cons.push({ tone: 'warn', code: 'con.blackout', p: { h: alt.blackoutH - base.blackoutH } });
      if (td.pSafe > base.pSafe + 0.005) pros.push({ tone: 'ok', code: 'pro.terrain', p: { p: td.pSafe * 100, b: base.pSafe * 100 } });
      else if (td.pSafe < base.pSafe - 0.005) cons.push({ tone: 'warn', code: 'con.terrain', p: { p: td.pSafe * 100, b: base.pSafe * 100 } });
      if (alt.minSocPct > base.minSocPct + 2) pros.push({ tone: 'ok', code: 'pro.battery', p: { soc: alt.minSocPct } });
    }
    if (alt.distanceM > 5000) cons.push({ tone: 'warn', code: 'con.far', p: { km: alt.distanceM / 1000 } });
    else pros.push({ tone: 'ok', code: 'pro.near', p: { km: alt.distanceM / 1000 } });
    if (td.gridM > 40) cons.push({ tone: 'info', code: 'con.coarse', p: {} });
    for (const r of alt.reasons) cons.push({ tone: 'bad', code: `rule.${r.code}`, p: {} });
    if (hi < req.minPSafe) cons.push({ tone: 'bad', code: 'rule.footprint', p: { p: td.pSafe * 100 } });

    const reason: Finding = verdict === 'suitable'
      ? { tone: 'ok', code: 'why.pass', p: { p: td.pSafe * 100, soc: alt.minSocPct, km: alt.distanceM / 1000 } }
      : verdict === 'conditional'
        ? { tone: 'warn', code: 'why.conditional', p: { p: td.pSafe * 100, soc: alt.minSocPct } }
        : { tone: 'bad', code: 'why.closest', p: { n: alt.reasons.length + (hi < req.minPSafe ? 1 : 0) } };
    items.push({ alt, td, verdict, score, confidence, pros, cons, reason });
  }
  items.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || b.score - a.score || a.alt.distanceM - b.alt.distanceM);
  return { items: items.slice(0, want), excluded, passing: items.filter((c) => c.verdict === 'suitable').length };
}
