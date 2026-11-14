/**
 * Alternatives for a rejected plan: nearby sites and nearby dates. Always returns suggestions (the closest-to-passing
 * ones when nothing passes). Shared by the site and result steps; one search per plan, cached by its inputs.
 */
import { useEffect, useState } from 'react';
import { ALT_RADIUS_KM, searchDates, searchSites, type DateAlternative, type SiteAlternative } from '../planner/alternatives';
import type { PlannerData } from '../data/data';
import { usePlanner } from '../state/store';
import type { Analysis } from './useAnalysis';

export interface Alternatives {
  /** Best sites found so far (null before the first ring is done). */
  readonly sites: readonly SiteAlternative[] | null;
  readonly dates: readonly DateAlternative[] | null;
  /** True while the 100 km search is still running. */
  readonly searching: boolean;
}

const NONE: Alternatives = { sites: null, dates: null, searching: false };

const cache = new Map<string, Alternatives>();

/** `wanted`: search now (site step: the site itself has a problem; result step: the plan is rejected). */
export function useAlternatives(data: PlannerData, a: Analysis | null, busy: boolean, wanted: boolean): Alternatives {
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const windowDays = usePlanner((s) => s.windowDays);
  const rejected = !busy && !!a && wanted;
  const key = `${a?.key ?? ''}|${windowDays}`;
  const [, bump] = useState(0);

  useEffect(() => {
    if (!a || !rejected || cache.has(key)) return;
    const ctl = new AbortController();
    const onlySlope = a.reasons.length > 0 && a.reasons.every((r) => r.code === 'slope');
    cache.set(key, { sites: null, dates: null, searching: true });
    (async () => {
      const dates = onlySlope ? [] : await searchDates(data.eph, data.terrain, site, startMs, endMs, windowDays, craft, limits, 4, ctl.signal);
      if (ctl.signal.aborted) return;
      cache.set(key, { sites: null, dates, searching: true });
      bump((n) => n + 1);
      const sites = await searchSites(data.eph, data.terrain, site, ALT_RADIUS_KM, startMs, endMs, craft, limits, 5, ctl.signal, (best) => {
        if (ctl.signal.aborted || best.length === 0) return;
        cache.set(key, { sites: best, dates, searching: true });
        bump((n) => n + 1);
      });
      if (ctl.signal.aborted) return;
      cache.set(key, { sites, dates, searching: false });
      bump((n) => n + 1);
    })();
    return () => { ctl.abort(); if (cache.get(key)?.searching) cache.delete(key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rejected]);

  return rejected ? cache.get(key) ?? NONE : NONE;
}
