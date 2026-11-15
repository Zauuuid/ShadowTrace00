import { useEffect, useState } from 'react';
import { assess, type Assessment } from '../planner/assess';
import { siteContext, type SiteContext } from '../planner/context';
import { computeHorizon, type Horizon } from '../planner/horizon';
import { analyseLanding, type LandingResult } from '../planner/landing';
import { powerCommsReasons, simulate, stepMinutesFor, type Insufficient, type MissionResult, type Reason } from '../planner/mission';
import { toXY } from '../planner/polar';
import { simulateTouchdowns, type TouchdownResult } from '../planner/uncertainty';
import type { PlannerData } from '../data/data';
import { usePlanner } from '../state/store';

export interface Analysis {
  readonly horizon: Horizon;
  readonly landing: LandingResult;
  readonly touchdown: TouchdownResult;
  readonly context: SiteContext;
  readonly assessment: Assessment;
  readonly mission: MissionResult | Insufficient;
  /** Hard-rule failures only (battery, blackout, touchdown probability below requirement). */
  readonly reasons: readonly Reason[];
  /** Legacy 3-state status kept for the v3 views; always consistent with `assessment.verdict`. */
  readonly status: 'suitable' | 'rejected' | 'insufficient';
  readonly key: string;
}

/** Full evaluation of the current plan. Recomputed when any input changes (debounced). */
export function useAnalysis(data: PlannerData | null): { a: Analysis | null; busy: boolean } {
  const site = usePlanner((s) => s.site);
  const dispersion = usePlanner((s) => s.dispersion);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const req = usePlanner((s) => s.req);
  const [a, setA] = useState<Analysis | null>(null);
  const key = JSON.stringify([site, dispersion, startMs, endMs, craft, limits, req]);
  const busy = a?.key !== key;
  useEffect(() => {
    if (!data) return;
    let live = true;
    const timer = setTimeout(async () => {
      const q = toXY(site);
      await data.terrain.ensureDetail(q, 13_000);
      if (!live) return;
      const horizon = computeHorizon(data.terrain, q, craft.mastM, 1);
      const landing = analyseLanding(data.terrain, q, dispersion, limits.legSpanM, limits.maxSlopeDeg);
      const touchdown = simulateTouchdowns(data.terrain, q, dispersion, limits.legSpanM, limits.maxSlopeDeg, { sigmaLevel: req.sigmaLevel, samples: req.samples, seed: 20261115 });
      const mission = simulate(data.eph, horizon, site, startMs, endMs, craft, limits, stepMinutesFor(endMs - startMs));
      const context = siteContext(site, data.names, data.vectors.psr.features);
      const assessment = assess(landing, touchdown, mission, limits, req, context);
      const reasons: Reason[] = [];
      if (touchdown.valid > 0 && touchdown.ci95[1] < req.minPSafe) reasons.push({ code: 'slope', slopeDeg: touchdown.slopeP95Deg, maxDeg: limits.maxSlopeDeg });
      if (!('kind' in mission)) reasons.push(...powerCommsReasons(mission, limits));
      const status = assessment.verdict === 'insufficient' ? 'insufficient' : assessment.verdict === 'unsuitable' ? 'rejected' : 'suitable';
      if (live) setA({ horizon, landing, touchdown, context, assessment, mission, reasons, status, key });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);
  return { a, busy };
}
