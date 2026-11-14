import { useEffect, useState } from 'react';
import { computeHorizon, type Horizon } from '../planner/horizon';
import { analyseLanding, type LandingResult } from '../planner/landing';
import { powerCommsReasons, simulate, stepMinutesFor, type Insufficient, type MissionResult, type Reason } from '../planner/mission';
import { toXY } from '../planner/polar';
import type { PlannerData } from '../data/data';
import { usePlanner } from '../state/store';

export interface Analysis {
  readonly horizon: Horizon;
  readonly landing: LandingResult;
  readonly mission: MissionResult | Insufficient;
  readonly reasons: readonly Reason[];
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
  const [a, setA] = useState<Analysis | null>(null);
  const key = JSON.stringify([site, dispersion, startMs, endMs, craft, limits]);
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
      const mission = simulate(data.eph, horizon, site, startMs, endMs, craft, limits, stepMinutesFor(endMs - startMs));
      const reasons: Reason[] = [];
      if (!landing.safe && landing.samples > 0) reasons.push({ code: 'slope', slopeDeg: landing.maxSlopeDeg, maxDeg: limits.maxSlopeDeg });
      if (!('kind' in mission)) reasons.push(...powerCommsReasons(mission, limits));
      const status = 'kind' in mission ? 'insufficient' : reasons.length ? 'rejected' : 'suitable';
      if (live) setA({ horizon, landing, mission, reasons, status, key });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key]);
  return { a, busy };
}
