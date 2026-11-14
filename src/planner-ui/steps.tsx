/** Planner steps 1–4 (chapter 07 §2). Behaviour from v2 (legacy-ui), look from chapter 06. No science maths here. */
import { useMemo, useState } from 'react';
import type { PlannerData } from '../data/data';
import { useAlternatives } from '../hooks/useAlternatives';
import type { Analysis } from '../hooks/useAnalysis';
import { ALT_RADIUS_KM } from '../planner/alternatives';
import { highestPoint } from '../planner/landing';
import { hours, SOLAR_CONSTANT_W_M2, type Limits, type PanelMode, type Spacecraft } from '../planner/mission';
import { distanceAz, toLatLon, toXY } from '../planner/polar';
import { fmtDate, fmtHours, fmtNum } from '../state/format';
import { dirName, useT, type Key } from '../state/i18n';
import { MAX_BATTERY_WH } from '../state/share';
import { DEFAULT_CRAFT, DEFAULT_DISPERSION, PRESETS, usePlanner, type LayerId } from '../state/store';
import { batteryTone, siteStatus } from '../state/tones';
import { reasonSentence, verdictSentences } from '../state/verdictText';
import { DatePicker } from './DatePicker';
import { MoonMap } from './MoonMap';
import { Badge, Icon, NumberField, OutageList, Skeleton, type Tone } from './widgets';

const HOUR = 3_600_000;

export function StepHead({ n, title, lead }: { n: number; title: string; lead?: string }) {
  const t = useT();
  return (
    <header className="step-head">
      <p className="eyebrow mono">{t('stepOf', { n: String(n).padStart(2, '0') })} · {t(`step${n}` as Key).toUpperCase()}</p>
      <h1 className="h1">{title}</h1>
      {lead ? <p className="lede">{lead}</p> : null}
    </header>
  );
}

// ---------------------------------------------------------------- 1 · Dates
export function DatesStep({ data }: { data: PlannerData }) {
  const t = useT();
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const set = usePlanner((s) => s.set);
  const durH = (endMs - startMs) / HOUR;
  const days = Math.floor(durH / 24), restH = Math.round(durH - days * 24);
  const min = data.eph.startMs, max = data.eph.endMs;
  const span = max - min;
  const a = ((startMs - min) / span) * 100, w = Math.max(0.5, ((endMs - startMs) / span) * 100);
  const years: number[] = [];
  for (let y = new Date(min).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < max; y++) years.push(y);
  return (
    <section className="step narrow">
      <StepHead n={1} title={t('yourDates')} />
      <div className="date-row">
        <DatePicker label={t('landingDate')} valueMs={startMs} min={min} max={max - HOUR}
          onChange={(v) => set({ startMs: v, endMs: endMs > v ? endMs : Math.min(max, v + (endMs - startMs)) })} />
        <DatePicker label={t('endDate')} valueMs={endMs} min={min + HOUR} max={max}
          onChange={(v) => set({ endMs: v, startMs: startMs < v ? startMs : Math.max(min, v - (endMs - startMs)) })} />
      </div>
      <div className="dur">
        <span className="label mono">{t('duration')}</span>
        <b className="num"><bdi>{days >= 1 ? fmtNum(days) : fmtNum(durH, 0)}</bdi> <small>{days >= 1 ? t('days') : t('hours')}</small>
          {days >= 1 && days < 10 && restH > 0 ? <small> + <bdi>{restH}</bdi> {t('hours')}</small> : null}</b>
        <div className="dbar" dir="ltr" aria-hidden="true">
          <div className="dbar-track">
            {years.map((y) => <i key={y} style={{ left: `${((Date.UTC(y, 0, 1) - min) / span) * 100}%` }} />)}
            <span className="dbar-fill" style={{ left: `${a}%`, width: `${w}%` }} />
          </div>
          <div className="dbar-years">{years.filter((_, k) => k % 2 === 0).map((y) => <em key={y} style={{ left: `${((Date.UTC(y, 0, 1) - min) / span) * 100}%` }}>{y}</em>)}</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 2 · Spacecraft
type Part = 'battery' | 'panels' | 'load';
const PAGES: readonly [1 | 2 | 3, Key, Part][] = [[1, 'craftPage1', 'battery'], [2, 'craftPage2', 'panels'], [3, 'craftPage3', 'load']];
const MODES: readonly [PanelMode, Key, string][] = [
  ['tracking', 'tracking', 'M20 6v28M14 10h12v20H14z'], ['fixed', 'fixed', 'M20 6v28M12 10h8v20h-8z'], ['horizontal', 'horizontal', 'M6 24h28M10 18h20v4H10z'],
];
const TONE: Record<'good' | 'warn' | 'bad' | 'nodata', Tone> = { good: 'ok', warn: 'warn', bad: 'bad', nodata: 'nodata' };

export function CraftStep({ a }: { a: Analysis | null }) {
  const t = useT();
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const windowDays = usePlanner((s) => s.windowDays);
  const preset = usePlanner((s) => s.preset);
  const page = usePlanner((s) => s.craftPage);
  const setCraft = usePlanner((s) => s.setCraft);
  const setLimits = usePlanner((s) => s.setLimits);
  const set = usePlanner((s) => s.set);
  const [adv, setAdv] = useState(false);
  const battH = (craft.batteryWh * craft.usableFrac) / Math.max(1, craft.nightLoadW);
  const peak = SOLAR_CONSTANT_W_M2 * craft.arrayAreaM2 * craft.arrayEff;
  const dark = a && !('kind' in a.mission) ? hours(a.mission.longestDark) : null;
  const tone = TONE[batteryTone(battH, dark)];
  return (
    <section className="step">
      <StepHead n={2} title={t('yourCraft')} />
      <div className="tabs" role="tablist">
        {PAGES.map(([n, k]) => (
          <button key={n} type="button" role="tab" aria-selected={page === n} className={page === n ? 'tab on' : 'tab'} onClick={() => set({ craftPage: n })}>
            <span className="mono">0{n}</span>{t(k)}
          </button>
        ))}
      </div>
      <div className="two-col craft">
        <Blueprint craft={craft} limits={limits} hot={PAGES[page - 1]![2]} />
        <div className="col-form">
          {page === 1 ? (
            <>
              <div className="chips" role="group" aria-label={t('likeVehicle')}>
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className={preset === p.id ? 'chip on' : 'chip'} aria-pressed={preset === p.id}
                    onClick={() => { setCraft({ ...DEFAULT_CRAFT, dayLoadW: craft.dayLoadW, nightLoadW: craft.nightLoadW, panel: craft.panel, mastM: craft.mastM, ...p.craft }); set({ preset: p.id }); }}>
                    {p.id === 'avg' ? t('average') : <span dir="ltr">{p.label}</span>}
                  </button>
                ))}
              </div>
              <p className="cap mono">{t('presetsCite')}</p>
              <NumberField label={t('batteryCap')} unit="Wh" value={craft.batteryWh} step={100} min={50} max={MAX_BATTERY_WH} onChange={(v) => setCraft({ batteryWh: v })} />
              <NumberField label={t('usable')} unit="%" value={Math.round(craft.usableFrac * 100)} step={5} min={10} max={100} onChange={(v) => setCraft({ usableFrac: v / 100 })} />
            </>
          ) : page === 2 ? (
            <>
              <NumberField label={t('arrayArea')} unit="m²" value={craft.arrayAreaM2} step={0.1} min={0.1} max={50} digits={1} onChange={(v) => setCraft({ arrayAreaM2: v })} />
              <NumberField label={t('arrayEff')} unit="%" value={Math.round(craft.arrayEff * 1000) / 10} step={0.5} min={1} max={45} digits={1} onChange={(v) => setCraft({ arrayEff: v / 100 })} />
              <div className="field-block">
                <span className="label mono">{t('panelMode')}</span>
                <div className="modes">
                  {MODES.map(([mode, k, d]) => (
                    <button key={mode} type="button" className={craft.panel === mode ? 'mode on' : 'mode'} aria-pressed={craft.panel === mode} onClick={() => setCraft({ panel: mode })}>
                      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="note"><Icon name="panel" size={18} />{t('arrayGives', { w: fmtNum(peak) })}</p>
            </>
          ) : (
            <>
              <NumberField label={t('dayLoad')} unit="W" note={t('enterYours')} value={craft.dayLoadW} step={10} min={1} max={5000} onChange={(v) => setCraft({ dayLoadW: v })} />
              <NumberField label={t('nightLoad')} unit="W" note={t('enterYours')} value={craft.nightLoadW} step={10} min={1} max={5000} onChange={(v) => setCraft({ nightLoadW: v })} />
              <button type="button" className="disclosure" aria-expanded={adv} onClick={() => setAdv(!adv)}><span>{t('advanced')}</span><Icon name={adv ? 'minus' : 'plus'} size={16} /></button>
              {adv ? (
                <div className="adv-grid">
                  <NumberField label={t('mast')} unit="m" value={craft.mastM} step={0.5} min={0.5} max={30} digits={1} onChange={(v) => setCraft({ mastM: v })} />
                  <NumberField label={t('minEarth')} unit="°" value={limits.minEarthElDeg} step={0.5} min={0} max={20} digits={1} onChange={(v) => setLimits({ minEarthElDeg: v })} />
                  <NumberField label={t('maxBlackout')} unit="h" value={limits.maxBlackoutH} step={6} min={1} max={720} onChange={(v) => setLimits({ maxBlackoutH: v })} />
                  <NumberField label={t('window')} unit="±d" value={windowDays} step={15} min={7} max={365} onChange={(v) => set({ windowDays: v })} />
                </div>
              ) : null}
            </>
          )}
          <div className={`strip ${tone}`} role="status">
            <Icon name="battery" />
            <div><b>{t('batteryLasts', { h: fmtHours(battH) })}</b><span>{dark === null ? t('noDataYet') : `${t('longestDark')}: ${fmtHours(dark)} ${t('hours')}`}</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Blueprint({ craft, limits, hot }: { craft: Spacecraft; limits: Limits; hot: Part }) {
  const t = useT();
  const peak = SOLAR_CONSTANT_W_M2 * craft.arrayAreaM2 * craft.arrayEff;
  const battH = (craft.batteryWh * craft.usableFrac) / Math.max(1, craft.nightLoadW);
  const cls = (p: Part | 'legs') => (p === hot ? 'bp-part hot' : 'bp-part');
  return (
    <figure className="bp">
      <svg viewBox="0 0 560 330" role="img" aria-label={t('illustrative')}>
        <line x1="40" y1="292" x2="520" y2="292" className="bp-ground" />
        <g className={cls('panels')}>
          <line x1="280" y1="130" x2="280" y2="78" /><line x1="196" y1="84" x2="364" y2="84" />
          <rect x="176" y="58" width="78" height="48" /><rect x="306" y="58" width="78" height="48" />
          {[1, 2].map((k) => <line key={`a${k}`} x1={176 + 26 * k} y1="58" x2={176 + 26 * k} y2="106" className="thin" />)}
          {[1, 2].map((k) => <line key={`b${k}`} x1={306 + 26 * k} y1="58" x2={306 + 26 * k} y2="106" className="thin" />)}
        </g>
        <g className={cls('load')}><path d="M226 130 H334 L350 150 V214 L334 232 H226 L210 214 V150 Z" /><circle cx="252" cy="180" r="9" className="thin" /></g>
        <g className={cls('battery')}><rect x="350" y="166" width="46" height="34" /><line x1="358" y1="190" x2="388" y2="190" className="thin" /></g>
        <g className={cls('legs')}><path d="M226 214 L170 286 M334 214 L390 286 M248 232 L232 286 M312 232 L328 286 M156 288 h28 M376 288 h28" /></g>
        <g className="bp-call"><path d="M176 82 H92 V60" /><path d="M396 183 H452 V150" /><path d="M226 168 H128 V182" /></g>
        <g className="bp-text">
          <text x="92" y="30" textAnchor="middle" className={hot === 'panels' ? 'hot' : ''}>{t('craftPage2')}</text>
          <text x="92" y="50" textAnchor="middle" className="v">{`${fmtNum(craft.arrayAreaM2, 1)} m² · ${t('peakW', { w: fmtNum(peak) })}`}</text>
          <text x="452" y="120" textAnchor="middle" className={hot === 'battery' ? 'hot' : ''}>{t('craftPage1')}</text>
          <text x="452" y="140" textAnchor="middle" className="v">{`${fmtNum(craft.batteryWh)} Wh · ${t('coversH', { h: fmtHours(battH) })}`}</text>
          <text x="128" y="202" textAnchor="middle" className={hot === 'load' ? 'hot' : ''}>{t('craftPage3')}</text>
          <text x="128" y="222" textAnchor="middle" className="v">{t('dayNight', { d: fmtNum(craft.dayLoadW), n: fmtNum(craft.nightLoadW) })}</text>
          <text x="170" y="318" textAnchor="middle" className="v">{t('legsInfo', { s: fmtNum(limits.legSpanM, 1), m: fmtNum(limits.maxSlopeDeg) })}</text>
        </g>
      </svg>
      <figcaption className="cap mono">{t('illustrative')}</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- 3 · Site
const LAYERS: readonly [LayerId, Key][] = [['suit', 'layerSuit'], ['earth', 'layerEarth'], ['psr', 'layerPsr'], ['grid', 'layerGrid'], ['detail', 'layerDetail']];
export function suitMonthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function SiteStep({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const layers = usePlanner((s) => s.layers);
  const toggle = usePlanner((s) => s.toggleLayer);
  const set = usePlanner((s) => s.set);
  const [latText, setLatText] = useState<string | null>(null);
  const [lonText, setLonText] = useState<string | null>(null);
  const minLat = data.terrain.minLatDeg;
  const nearby = useMemo(() => data.names.map((n) => ({ n, d: distanceAz(site, n) })).sort((x, y) => x.d.m - y.d.m).slice(0, 5), [data.names, site]);
  const ground = data.terrain.heightAt(toXY(site));
  const m = a && !('kind' in a.mission) ? a.mission : null;
  const s3 = siteStatus(a?.reasons ?? [], !!a && 'kind' in a.mission);
  const commit = () => {
    const lat = latText?.trim() === '' ? NaN : Number(latText ?? site.lat), lon = lonText?.trim() === '' ? NaN : Number(lonText ?? site.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat <= minLat && lat >= -90 && lon >= -180 && lon <= 180) set({ site: { lat, lon } });
    setLatText(null); setLonText(null);
  };
  return (
    <section className="step">
      <StepHead n={3} title={t('whereLand')} lead={t('tapMap')} />
      <div className="two-col wide-main">
        <div className="col-main">
          <MoonMap data={data} site={site} onPick={(p) => set({ site: p })} highlight={nearby.map((x) => x.n.name)} height={Math.max(420, Math.round(window.innerHeight * 0.62))} showLegend suitMonth={suitMonthOf(startMs)} initialRes={240} />
          <p className="cap mono">{t('mapBadge')}</p>
          <div className="chips" role="group" aria-label={t('layers')}>
            {LAYERS.map(([id, k]) => <button key={id} type="button" className={layers[id] ? 'chip on' : 'chip'} aria-pressed={layers[id]} onClick={() => toggle(id)}>{t(k)}</button>)}
          </div>
          <div className="block">
            <h3 className="h3">{t('artemisSites')}</h3>
            <p className="muted small">{t('artemisHint')}</p>
            <div className="chips">
              {data.vectors.artemis3.features.map((f) => {
                const r = f.rings[0]!;
                const cx = r.slice(0, -1).reduce((s, p) => s + p[0]!, 0) / (r.length - 1);
                const cy = r.slice(0, -1).reduce((s, p) => s + p[1]!, 0) / (r.length - 1);
                return <button key={f.label} type="button" className="chip" dir="ltr" onClick={async () => { await data.terrain.ensureDetail({ x: cx, y: cy }, 15_000); set({ site: toLatLon(highestPoint(data.terrain, r, 120)) }); }}>{f.label}</button>;
              })}
            </div>
          </div>
        </div>
        <aside className="col-side">
          <div className="coords">
            <label className="field"><span className="label mono">{t('lat')}</span><span className="field-in"><input dir="ltr" value={latText ?? site.lat.toFixed(4)} onChange={(e) => setLatText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /><em>°</em></span></label>
            <label className="field"><span className="label mono">{t('lon')}</span><span className="field-in"><input dir="ltr" value={lonText ?? site.lon.toFixed(4)} onChange={(e) => setLonText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /><em>°</em></span></label>
          </div>
          <p className="muted small">{t('elevation')} <b dir="ltr">{Number.isFinite(ground) ? `${fmtNum(ground)} m` : '—'}</b> · LRO LOLA</p>
          <div className="block notes" aria-live="polite">
            {!a || busy ? <Skeleton label={a ? t('recomputing') : t('loading')} /> : (
              <>
                <Badge tone={s3.status === 'good' ? 'ok' : s3.status === 'warn' ? 'warn' : 'nodata'}>{t(s3.status === 'good' ? 'siteGood' : s3.status === 'warn' ? 'siteWarn' : 'insufficient')}</Badge>
                <p>{s3.status === 'good' && m ? t('siteGoodSentence', { d: fmtHours(hours(m.longestDark)), b: fmtHours(m.batteryHours), e: fmtHours(hours(m.longestBlackout)) })
                  : s3.status === 'warn' ? s3.reasons.map((r) => reasonSentence(t, r)).join(' · ') : verdictSentences(t, a)[0]}</p>
                {s3.status === 'warn' ? <Suggestions data={data} a={a} busy={busy} /> : null}
                {m ? <><OutageList runs={m.darkRuns} kind="sun" max={3} /><OutageList runs={m.blackoutRuns} kind="earth" max={3} /></> : null}
              </>
            )}
          </div>
          <div className="block">
            <h3 className="h3">{t('nearby')}</h3>
            <ul className="ledger-list near">
              {nearby.map(({ n, d }) => <li key={n.name}><span dir="ltr">{n.name}</span><b dir="ltr">{d.m < 1000 ? `${fmtNum(d.m)} m` : `${fmtNum(d.m / 1000, 1)} km`}</b><em>{dirName(lang, d.az)}</em></li>)}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Suggestions({ data, a, busy }: { data: PlannerData; a: Analysis; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const set = usePlanner((s) => s.set);
  const { sites, dates, searching } = useAlternatives(data, a, busy, true);
  return (
    <div className="sugg">
      <h4 className="label mono">{t('tryInstead')}</h4>
      {(sites ?? []).slice(0, 3).map((x, i) => (
        <button key={`s${i}`} type="button" className="row-btn" onClick={() => set({ site: x.site })}>
          <Icon name="pin" size={18} /><span><bdi>{fmtNum(x.distanceM / 1000, 1)}</bdi> {t('km')} {dirName(lang, x.azDeg)}</span>
          <Badge tone={x.passes ? 'ok' : 'warn'}>{t(x.passes ? 'altPasses' : 'altClosest')}</Badge>
        </button>
      ))}
      {(dates ?? []).slice(0, 2).map((d) => (
        <button key={`d${d.shiftDays}`} type="button" className="row-btn" onClick={() => set({ startMs: d.startMs, endMs: d.endMs })}>
          <Icon name="calendar" size={18} /><span>{t(d.shiftDays > 0 ? 'daysLater' : 'daysEarlier', { n: Math.abs(d.shiftDays) })} · <bdi>{fmtDate(d.startMs, lang, tz)}</bdi></span>
          <Badge tone={d.passes ? 'ok' : 'warn'}>{t(d.passes ? 'altPasses' : 'altClosest')}</Badge>
        </button>
      ))}
      {searching ? <Skeleton label={t('searchingWide', { km: ALT_RADIUS_KM })} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- 4 · Error margin
const DIRS: readonly ['northM' | 'eastM' | 'southM' | 'westM', Key][] = [['northM', 'north'], ['eastM', 'east'], ['southM', 'south'], ['westM', 'west']];

export function MarginStep({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const site = usePlanner((s) => s.site);
  const dispersion = usePlanner((s) => s.dispersion);
  const limits = usePlanner((s) => s.limits);
  const set = usePlanner((s) => s.set);
  const setLimits = usePlanner((s) => s.setLimits);
  const landing = busy ? undefined : a?.landing; // never show the previous site's result
  const isDefault = DIRS.every(([k]) => dispersion[k] === DEFAULT_DISPERSION[k]);
  const reach = Math.max(dispersion.northM, dispersion.eastM, dispersion.southM, dispersion.westM, ...(landing?.safeAims ?? []).map((s) => s.distanceM + 100));
  const farRes = Math.max(2, Math.round((reach * 2.4) / 420));
  return (
    <section className="step">
      <StepHead n={4} title={t('marginTitle')} lead={t('driftQ')} />
      <div className="two-col wide-main">
        <div className="col-main">
          <MoonMap key={farRes} data={data} site={site} dispersion={dispersion} height={440} initialRes={farRes}
            markers={(landing && !landing.safe ? landing.safeAims : []).map((s, k) => ({ id: `aim${k}`, at: toLatLon(s.aim), label: String(k + 1), tone: 'good' as const, onClick: () => set({ site: toLatLon(s.aim) }) }))} />
          <div className="chips"><button type="button" className={isDefault ? 'chip on' : 'chip'} onClick={() => set({ dispersion: DEFAULT_DISPERSION })}>{t('suggested')}</button></div>
          <div className="grid4">
            {DIRS.map(([k, label]) => <NumberField key={k} label={t(label)} unit={t('m')} value={dispersion[k]} step={25} min={0} max={5000} onChange={(v) => set({ dispersion: { ...dispersion, [k]: v } })} />)}
          </div>
          <div className="grid2">
            <NumberField label={t('legSpan')} unit={t('m')} value={limits.legSpanM} step={0.5} min={1} max={30} digits={1} onChange={(v) => setLimits({ legSpanM: v })} />
            <NumberField label={t('maxSlope')} unit="°" value={limits.maxSlopeDeg} step={1} min={1} max={30} onChange={(v) => setLimits({ maxSlopeDeg: v })} />
          </div>
        </div>
        <aside className="col-side">
          <h3 className="h3">{t('landingTitle')}</h3>
          <div aria-live="polite">
            {landing && landing.samples > 0 ? (
              <div className="zone-result">
                <SectorRing sectors={landing.sectors} max={limits.maxSlopeDeg} />
                <Badge tone={landing.safe ? 'ok' : 'bad'}>{landing.safe ? t('safeLanding') : t('unsafeLanding')}</Badge>
                {!landing.safe ? <p>{t('slopeWarn', { s: fmtNum(landing.maxSlopeDeg, 1), m: fmtNum(limits.maxSlopeDeg) })}</p> : null}
                {!landing.safe ? <p className="muted small">{t('steepTowards')}: {landing.sectors.map((v, k) => (v > limits.maxSlopeDeg ? k : -1)).filter((k) => k >= 0).map((k) => dirName(lang, k * 45)).join(lang === 'ar' ? '، ' : ', ')}</p> : null}
                <ul className="ledger-list">
                  <li><span>{t('worstSlope')}</span><b><bdi>{fmtNum(landing.maxSlopeDeg, 1)}°</bdi> · {dirName(lang, landing.maxSlopeAzDeg)}</b></li>
                  <li><span>{t('legDrop')}</span><b><bdi>{fmtNum(landing.legDropM, 2)} m</bdi></b></li>
                </ul>
                <p className="cap mono">{t('slopeBaseline', { b: fmtNum(landing.baselineM) })}</p>
                <p className="note"><Icon name="info" size={18} />{t('slope.necessaryNotSufficient')}</p>
              </div>
            ) : <Skeleton label={busy ? t('recomputing') : t('loading')} />}
          </div>
          {landing && !landing.safe && landing.safeAims.length ? (
            <div className="aims">
              <h4 className="label mono">{t('safeAimsTitle')}</h4>
              <ol>
                {landing.safeAims.map((s, k) => (
                  <li key={s.azDeg}>
                    <button type="button" className="row-btn" onClick={() => set({ site: toLatLon(s.aim) })}>
                      <span className="aim-n mono">{k + 1}</span><span>{t('moveAim', { d: fmtNum(s.distanceM), dir: dirName(lang, s.azDeg) })}</span><em className="mono">{t('slopeThere', { s: fmtNum(s.maxSlopeDeg, 1) })}</em>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {landing && !landing.safe && !landing.safeAims.length && landing.samples > 0 ? <p className="small bad-t">{t('noSafeNear')}</p> : null}
        </aside>
      </div>
    </section>
  );
}

export function SectorRing({ sectors, max }: { sectors: readonly number[]; max: number }) {
  const R = 46, r = 20, D = Math.PI / 180;
  return (
    <svg width="112" height="112" viewBox="-56 -56 112 112" role="img" aria-label="slope by direction" className="ring" direction="ltr">
      {sectors.map((v, i) => {
        const a0 = (i * 45 - 22.5 - 90) * D, a1 = (i * 45 + 22.5 - 90) * D;
        const d = `M${r * Math.cos(a0)},${r * Math.sin(a0)} L${R * Math.cos(a0)},${R * Math.sin(a0)} A${R},${R} 0 0 1 ${R * Math.cos(a1)},${R * Math.sin(a1)} L${r * Math.cos(a1)},${r * Math.sin(a1)} A${r},${r} 0 0 0 ${r * Math.cos(a0)},${r * Math.sin(a0)} Z`;
        return <path key={i} d={d} className={v > max ? 'sec bad' : v > max * 0.6 ? 'sec warn' : 'sec ok'} />;
      })}
      <text x="0" y="-50" textAnchor="middle" className="tick">N</text>
    </svg>
  );
}
