/** Shared pieces of the mission journey: spacecraft image, screen header, next-step bar, site helpers. */
import type { ReactNode } from 'react';
import type { PlannerData } from '../data/data';
import { fleetSpec, type CraftId } from '../planner/fleet';
import { distanceAz, toXY, type LatLon } from '../planner/polar';
import { useT, type Key } from '../state/i18n';
import { usePlanner, type Page } from '../state/store';
import { Icon } from '../planner-ui/widgets';

export const ASSETS = `${import.meta.env.BASE_URL}assets/`;
export type View = 'perspective' | 'top';

export function craftOf(id: CraftId | 'custom'): CraftId { return id === 'custom' ? 'explorer' : id; }

/** The team's spacecraft, never stretched (object-fit: contain), with a meaningful alt text. */
export function CraftImage({ id, view = 'perspective', className, eager }: { id: CraftId | 'custom'; view?: View; className?: string; eager?: boolean }) {
  const t = useT();
  const c = craftOf(id);
  const s = fleetSpec(c);
  return (
    <img className={`craft-img ${className ?? ''}`} src={`${ASSETS}spacecraft/${c}-${view}.webp`} loading={eager ? 'eager' : 'lazy'} decoding="async"
      alt={`${t(`f.${c}.name` as Key)} — ${t(`f.${c}.class` as Key)}, ${s.heightM} m × ${s.legSpanM} m (${t(`f.view.${view}` as Key)})`} draggable={false} />
  );
}

export function ScreenHead({ kicker, title, lead, children }: { kicker: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <header className="screen-head">
      <p className="eyebrow mono">{kicker}</p>
      <h1 className="display">{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </header>
  );
}

/** Sticky bottom action on mobile, inline on desktop. */
export function NextBar({ back, next, label, disabled, hint }: { back?: Page; next: () => void; label: string; disabled?: boolean; hint?: ReactNode }) {
  const t = useT();
  const set = usePlanner((s) => s.set);
  return (
    <div className="next-bar">
      {back ? <button type="button" className="btn-text" onClick={() => set({ page: back })}><Icon name="arrow" size={18} className="flip" />{t('nav.back')}</button> : <span />}
      {hint ? <span className="next-hint small muted">{hint}</span> : null}
      <button type="button" className="btn-primary" onClick={next} disabled={disabled}><span>{label}</span><Icon name="arrow" size={18} className="flip-rtl" /></button>
    </div>
  );
}

/** Nearest IAU feature to a site. */
export function nearest(data: PlannerData, site: LatLon): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const n of data.names) { const d = distanceAz(site, n).m / 1000; if (!best || d < best.km) best = { name: n.name, km: d }; }
  return best;
}

export function inCoverage(data: PlannerData, p: LatLon): boolean {
  return p.lat <= data.terrain.minLatDeg && data.terrain.covers(toXY(p));
}

/** Human silhouette for the size comparison (generic, 1.8 m tall in its viewBox units). */
export function Person({ heightPx }: { heightPx: number }) {
  return (
    <svg className="person" width={heightPx * 0.32} height={heightPx} viewBox="0 0 32 100" aria-hidden="true">
      <circle cx="16" cy="9" r="7" />
      <path d="M9 20h14l3 34h-5l-2 44h-5l-1-34-1 34h-5l-2-44H6z" />
    </svg>
  );
}
