/**
 * Screen 03 — define the mission: name, landing date, duration and the landing site (search, suggested regions,
 * tap on the 3D Moon, or coordinates). Expert mode adds landing uncertainty and mission requirements.
 */
import { useMemo, useState } from 'react';
import type { PlannerData } from '../data/data';
import { Globe } from '../globe/Globe';
import { highestPoint } from '../planner/landing';
import { toLatLon, toXY, type LatLon } from '../planner/polar';
import { fmtNum, fromInput, toInput } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';
import { Icon, NumberField } from '../planner-ui/widgets';
import { NextBar, ScreenHead, inCoverage, nearest } from './common';

const DAY = 86_400_000;
const EPH_MIN = Date.parse('2026-11-01T00:00:00Z');
const EPH_MAX = Date.parse('2035-12-31T00:00:00Z');

export function Mission({ data }: { data: PlannerData }) {
  const t = useT();
  const tz = usePlanner((s) => s.tz);
  const mode = usePlanner((s) => s.mode);
  const name = usePlanner((s) => s.missionName);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const d = usePlanner((s) => s.dispersion);
  const limits = usePlanner((s) => s.limits);
  const req = usePlanner((s) => s.req);
  const set = usePlanner((s) => s.set);
  const setLimits = usePlanner((s) => s.setLimits);
  const setReq = usePlanner((s) => s.setReq);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [lat, setLat] = useState<string | null>(null);
  const [lon, setLon] = useState<string | null>(null);
  const [view, setView] = useState({ lat: site.lat, lon: site.lon, dist: 1.6 });
  const days = Math.max(1, Math.round((endMs - startMs) / DAY));

  const pick = (p: LatLon, label?: string) => {
    if (!inCoverage(data, p)) { setMsg(t('m.outside', { name: label ?? `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°` })); return; }
    setMsg(null); setLat(null); setLon(null);
    set({ site: p });
    setView({ lat: p.lat, lon: p.lon, dist: Math.min(view.dist, 1.25) });
  };
  const pickRegion = async (ring: readonly (readonly number[])[], label: string) => {
    const r = ring.slice(0, -1);
    const c = { x: r.reduce((s, p) => s + p[0]!, 0) / r.length, y: r.reduce((s, p) => s + p[1]!, 0) / r.length };
    await data.terrain.ensureDetail(c, 15_000);
    pick(toLatLon(highestPoint(data.terrain, ring, 120)), label);
  };
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const regions = data.vectors.artemis3.features.filter((f) => f.label.toLowerCase().includes(s)).map((f) => ({ kind: 'region' as const, label: f.label, f }));
    const names = data.names.filter((n) => n.name.toLowerCase().includes(s)).slice(0, 8).map((n) => ({ kind: 'name' as const, label: n.name, n }));
    return [...regions, ...names].slice(0, 9);
  }, [q, data]);
  const near = nearest(data, site);
  const elev = data.terrain.heightAt(toXY(site));
  const commitCoords = () => {
    const la = Number(lat ?? site.lat), lo = Number(lon ?? site.lon);
    if (Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) pick({ lat: la, lon: lo });
  };

  return (
    <main id="main" className="screen mission">
      <ScreenHead kicker={t('nav.step', { n: 2 })} title={t('m.title')} />
      <div className="mission-grid">
        <div className="mission-form">
          <label className="field big">
            <span className="label mono">{t('m.name')}</span>
            <input value={name} maxLength={60} placeholder={t('m.namePh')} onChange={(e) => set({ missionName: e.target.value })} />
          </label>
          <div className="row2">
            <label className="field">
              <span className="label mono">{t('m.date')} ({tz === 'utc' ? 'UTC' : 'UTC+3'})</span>
              <input type="datetime-local" dir="ltr" value={toInput(startMs, tz)} min={toInput(EPH_MIN, tz)} max={toInput(EPH_MAX - days * DAY, tz)}
                onChange={(e) => { const v = fromInput(e.target.value, tz); if (v !== null && v >= EPH_MIN && v + days * DAY <= EPH_MAX) set({ startMs: v, endMs: v + days * DAY }); }} />
            </label>
            <NumberField label={t('m.duration')} unit={t('m.days')} value={days} step={1} min={1} max={365} onChange={(v) => { const n = Math.round(v); if (startMs + n * DAY <= EPH_MAX) set({ endMs: startMs + n * DAY }); }} />
          </div>

          <h2 className="h3 where">{t('m.where')}</h2>
          <div className="search">
            <Icon name="target" size={18} />
            <input type="search" value={q} placeholder={t('m.searchPh')} aria-label={t('m.search')} onChange={(e) => setQ(e.target.value)} dir="auto" />
          </div>
          {q.trim().length >= 2 ? (
            <ul className="search-results" role="listbox">
              {results.length === 0 ? <li className="muted small">{t('m.noResults')}</li> : results.map((r) => (
                <li key={`${r.kind}-${r.label}`}>
                  <button type="button" onClick={() => { setQ(''); if (r.kind === 'region') void pickRegion(r.f.rings[0]!, r.label); else pick({ lat: r.n.lat, lon: r.n.lon }, r.label); }}>
                    <span dir="ltr">{r.label}</span>
                    <span className="mono small muted">{r.kind === 'region' ? 'Artemis III' : `${r.n.kind} · ${fmtNum(r.n.diameterKm)} km · ${r.n.lat.toFixed(1)}°`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="label mono">{t('m.suggested')}</p>
          <div className="chips">
            {data.vectors.artemis3.features.map((f) => <button key={f.label} type="button" className="chip" dir="ltr" onClick={() => void pickRegion(f.rings[0]!, f.label)}>{f.label}</button>)}
          </div>
          <p className="label mono">{t('m.orCoords')}</p>
          <div className="row2 coords">
            <label className="field"><span className="label mono">{t('lat')}</span><input dir="ltr" inputMode="decimal" value={lat ?? site.lat.toFixed(4)} onChange={(e) => setLat(e.target.value)} onBlur={commitCoords} onKeyDown={(e) => e.key === 'Enter' && commitCoords()} /><em className="small muted">{t('m.latHelp')}</em></label>
            <label className="field"><span className="label mono">{t('lon')}</span><input dir="ltr" inputMode="decimal" value={lon ?? site.lon.toFixed(4)} onChange={(e) => setLon(e.target.value)} onBlur={commitCoords} onKeyDown={(e) => e.key === 'Enter' && commitCoords()} /><em className="small muted">{t('m.lonHelp')}</em></label>
          </div>
          {msg ? <p className="note warn" role="alert">{msg}</p> : null}
          <p className="small muted">{t('m.coverage')}</p>

          {mode === 'expert' ? (
            <details className="expert-box" open>
              <summary className="h3">{t('m.advanced')}</summary>
              <p className="label mono">{t('m.uncertainty')}</p>
              <div className="grid4">
                {(['northM', 'eastM', 'southM', 'westM'] as const).map((k) => <NumberField key={k} label={t(k.replace('M', '') as Key)} unit="m" value={d[k]} step={25} min={0} max={5000} onChange={(v) => set({ dispersion: { ...d, [k]: v } })} />)}
              </div>
              <div className="grid3">
                <NumberField label={t('v4.req.pSafe')} unit="%" value={req.minPSafe * 100} step={0.5} min={50} max={99.9} digits={1} onChange={(v) => setReq({ minPSafe: v / 100 })} />
                <NumberField label={t('v4.req.sigma')} unit="σ" value={req.sigmaLevel} step={0.5} min={1} max={5} digits={1} note={t('v4.req.sigma.note', { k: fmtNum(req.sigmaLevel, 1), pct: fmtNum(100 * (1 - Math.exp(-(req.sigmaLevel ** 2) / 2)), 1) })} onChange={(v) => setReq({ sigmaLevel: v })} />
                <NumberField label={t('v4.req.samples')} unit="" value={req.samples} step={200} min={200} max={4000} onChange={(v) => setReq({ samples: Math.round(v) })} />
                <NumberField label={t('minEarth')} unit="°" value={limits.minEarthElDeg} step={0.5} min={0} max={20} digits={1} onChange={(v) => setLimits({ minEarthElDeg: v })} />
                <NumberField label={t('maxBlackout')} unit="h" value={limits.maxBlackoutH} step={6} min={1} max={720} onChange={(v) => setLimits({ maxBlackoutH: v })} />
              </div>
              <p className="cap mono">{t('v4.req.note')}</p>
            </details>
          ) : null}
        </div>

        <div className="mission-globe">
          <Globe data={data} view={view} onView={setView} onPick={(p) => pick(p)} label={t('m.orMap')}
            markers={[{ id: 'target', at: site, label: name || t('m.selected'), tone: 'target' }]} layers={{ relief: true, suit: false, psr: false, artemis: true }} />
          <div className="globe-caption">
            <p className="mono small"><Icon name="pin" size={14} /> {t('m.orMap')}</p>
            <div className="site-card">
              <span className="label mono">{t('m.selected')}</span>
              <b dir="ltr" className="mono">{site.lat.toFixed(4)}°, {site.lon.toFixed(4)}°</b>
              <span className="small muted">{near ? t('m.near', { d: fmtNum(near.km, near.km < 10 ? 1 : 0), name: near.name }) : ''}{Number.isFinite(elev) ? ` · ${t('m.elev')} ${fmtNum(elev)} m` : ''}</span>
            </div>
          </div>
        </div>
      </div>
      <NextBar back="fleet" next={() => set({ page: 'launch' })} label={t('m.launch')} hint={<bdi>{name || t('m.untitled')}</bdi>} />
    </main>
  );
}
