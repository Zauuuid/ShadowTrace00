/**
 * Screen 07 — up to five evidence-supported alternatives, on the same interactive Moon as the original target.
 * Selecting a candidate flies the globe to it; "Assess this site" moves the mission there and re-runs everything.
 */
import { useState } from 'react';
import type { PlannerData } from '../data/data';
import { Globe, type GlobeMarker } from '../globe/Globe';
import type { Analysis } from '../hooks/useAnalysis';
import { useT } from '../state/i18n';
import { usePlanner } from '../state/store';
import { CandidateList, candidateTone, useCandidates } from '../planner-ui/assessment';
import { NextBar, ScreenHead } from './common';
import { ALT_RADIUS_KM } from '../planner/alternatives';

export function Alternatives({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const site = usePlanner((s) => s.site);
  const set = usePlanner((s) => s.set);
  const st = useCandidates(data, a, busy, true);
  const [open, setOpen] = useState<number | null>(0);
  const [view, setView] = useState({ lat: site.lat, lon: site.lon, dist: 1.12 });
  const items = st.set5?.items ?? [];
  const focus = (i: number | null) => {
    setOpen(i);
    const c = i === null ? null : items[i];
    if (c) setView({ lat: c.alt.site.lat, lon: c.alt.site.lon, dist: c.alt.distanceM > 30_000 ? 1.14 : 1.06 });
  };
  const markers: GlobeMarker[] = [
    { id: 'target', at: site, label: t('a.original'), tone: 'target', onClick: () => setView({ lat: site.lat, lon: site.lon, dist: 1.06 }) },
    ...items.map((c, i) => ({ id: `c${i}`, at: c.alt.site, label: String(i + 1), tone: (candidateTone(c) === 'nodata' ? 'info' : candidateTone(c)) as GlobeMarker['tone'], title: `${i + 1}`, onClick: () => focus(i) })),
  ];
  return (
    <main id="main" className="screen alternatives">
      <ScreenHead kicker={t('nav.step', { n: 6 })} title={t('a.title')} lead={t('v4.alt.lead', { km: ALT_RADIUS_KM })} />
      <div className="alt-layout">
        <div className="alt-globe">
          <Globe data={data} view={view} onView={setView} markers={markers} label={t('a.title')} layers={{ relief: true, suit: false, psr: true, artemis: false }} />
        </div>
        <div className="alt-list">
          <CandidateList st={st} open={open} onOpen={focus} />
        </div>
      </div>
      <NextBar back="decision" next={() => set({ page: 'report' })} label={t('d.report')} />
    </main>
  );
}
