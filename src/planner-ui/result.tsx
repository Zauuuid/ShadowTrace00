/** Planner steps 5–6, explainers and the Data Confidence rows (chapters 02 §9, 07 §2). */
import { useEffect, useState } from 'react';
import type { PlannerData, SourceEntry } from '../data/data';
import { loadSources } from '../data/data';
import type { Analysis } from '../hooks/useAnalysis';
import { horizonAt } from '../planner/horizon';
import { hours, majorEvents, SOLAR_CONSTANT_W_M2, type MissionResult } from '../planner/mission';
import { distanceAz } from '../planner/polar';
import { fmtDate, fmtDateTime, fmtHours, fmtNum } from '../state/format';
import { dirName, useT, type Key } from '../state/i18n';
import { outageRows } from '../state/outages';
import { encodeMission } from '../state/share';
import { usePlanner } from '../state/store';
import { verdictSentences } from '../state/verdictText';
import { SeriesChart, type Factor } from './charts';
import { SectorRing } from './steps';
import { Timeline } from './Timeline';
import { FindingsList, findingText } from './assessment';
import type { Candidate } from '../planner/candidates';
import { SavedAssessments } from './saved';
import { Badge, Icon, MiniMoon, OutageList, Sheet, Skeleton, type IconName, type Tone } from './widgets';

const HOUR = 3_600_000;
export type Metric = 'solar' | 'energy' | 'earth' | 'terrain';
const VERDICT: Record<Analysis['status'], { k: Key; tone: Tone }> = {
  suitable: { k: 'verdict.suitable', tone: 'ok' }, rejected: { k: 'verdict.notSuitable', tone: 'bad' }, insufficient: { k: 'verdict.insufficient', tone: 'nodata' },
};

// ---------------------------------------------------------------- Data confidence
interface ConfRow { metric: Metric; source: string; resolution: string; period: string; assumptions: string; missing: string; limits: string }
export function useConfidence(): ConfRow[] {
  const t = useT();
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const period = `${fmtDate(startMs, lang, tz)} → ${fmtDate(endMs, lang, tz)} · Horizons 2026-11 → 2035-12, 1 h`;
  const loadsUntouched = craft.dayLoadW === 150 && craft.nightLoadW === 100;
  return [
    { metric: 'solar', source: 'NASA JPL Horizons + NASA PDS LRO LOLA', resolution: '1 h ephemeris · 40 m / 240 m terrain', period, assumptions: t('conf.sun.a'), missing: t('conf.none'), limits: t('conf.sun.l') },
    { metric: 'energy', source: 'Horizons + LOLA + your spacecraft inputs', resolution: '10 min simulation step (coarser for long missions)', period,
      assumptions: t('conf.energy.a', { p: t(craft.panel), e: fmtNum(craft.arrayEff * 100, 1), m: fmtNum(craft.mastM, 1) }), missing: loadsUntouched ? t('conf.energy.miss') : t('conf.none'), limits: t('conf.energy.l') },
    { metric: 'earth', source: 'NASA JPL Horizons + NASA PDS LRO LOLA', resolution: '1 h ephemeris · 40 m / 240 m terrain', period, assumptions: t('conf.earth.a', { d: fmtNum(limits.minEarthElDeg, 1) }), missing: t('conf.none'), limits: t('conf.earth.l') },
    { metric: 'terrain', source: 'NASA PDS LRO LOLA', resolution: '40 m (85°S → pole) · 240 m (to 75°S)', period: 'LOLA GDR, PDS release', assumptions: t('conf.terrain.a'), missing: t('conf.none'), limits: t('conf.terrain.l') },
  ];
}

export function ConfidenceTable({ only }: { only?: Metric }) {
  const t = useT();
  const rows = useConfidence().filter((r) => !only || r.metric === only);
  return (
    <div className="conf">
      {rows.map((r) => (
        <dl key={r.metric} className="conf-row">
          <dt className="h3">{t(`explainer.${r.metric}` as Key)}</dt>
          <div><dt className="label mono">{t('confidence.source')}</dt><dd>{r.source}</dd></div>
          <div><dt className="label mono">{t('confidence.resolution')}</dt><dd>{r.resolution}</dd></div>
          <div><dt className="label mono">{t('confidence.period')}</dt><dd><bdi>{r.period}</bdi></dd></div>
          <div><dt className="label mono">{t('confidence.assumptions')}</dt><dd>{r.assumptions}</dd></div>
          <div><dt className="label mono">{t('confidence.missing')}</dt><dd>{r.missing}</dd></div>
          <div><dt className="label mono">{t('confidence.limits')}</dt><dd>{r.limits}</dd></div>
        </dl>
      ))}
    </div>
  );
}

export function SourcesList() {
  const t = useT();
  const [src, setSrc] = useState<readonly SourceEntry[]>([]);
  useEffect(() => { loadSources().then(setSrc, () => undefined); }, []);
  return (
    <ul className="ledger-list sources-list">
      {src.map((s) => (
        <li key={s.id}>
          <a href={s.url} target="_blank" rel="noreferrer" dir="ltr">{s.name}</a>
          <span className="mono small">{[s.resolution, s.period, s.usedFor.join(', ')].filter(Boolean).join(' · ')}</span>
          {!s.scientific ? <em className="small">{t('confidence.visual')}{s.note ? ` — “${s.note}”` : ''}</em> : null}
        </li>
      ))}
    </ul>
  );
}

export function ConfidenceDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Sheet side title={t('confidence.title')} onClose={onClose}>
      <SourcesList />
      <ConfidenceTable />
      <p className="cap mono">{t('geometryNote')}</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 5 · Result
export function TechnicalDetails({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const limits = usePlanner((s) => s.limits);
  const mode = usePlanner((s) => s.mode);
  const [explain, setExplain] = useState<Metric | null>(null);
  const [drawer, setDrawer] = useState(false);
  if (!a) return <Skeleton label={t('loading')} />;
  void busy;
  const m = 'kind' in a.mission ? null : a.mission;
  const v = VERDICT[a.status];
  const cell = (metric: Metric, label: Key, value: string, unit: string, bad: boolean, sub?: string) => (
    <button type="button" className={bad ? 'cell bad' : 'cell'} onClick={() => setExplain(metric)}>
      <span className="label mono">{t(label)}</span>
      <b className="num"><bdi>{value}</bdi><small>{unit}</small></b>
      {sub ? <em className="mono small">{sub}</em> : <em className="mono small">{t('explainer.' + metric as Key)}</em>}
    </button>
  );
  return (
    <section className="tech">
      <details className="v4-details block" open={mode === 'expert'}>
        <summary><span className="h2">{t('v4.details')}</span><span className="muted small">{t('v4.detailsHint')}</span></summary>
        <div className="block"><h3 className="h3">{t('v4.allFindings')}</h3><FindingsList s={a.assessment} /></div>
        <ul className="v-sent legacy">{verdictSentences(t, a).map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="v-meta mono"><bdi>{fmtDateTime(startMs, lang, tz)}</bdi> → <bdi>{fmtDateTime(endMs, lang, tz)}</bdi> · <bdi dir="ltr">{site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°</bdi> · {t(v.k)}</p>
      {m ? (
        <>
          <div className="metric-ledger">
            {cell('solar', 'longestDark', fmtHours(hours(m.longestDark)), t('hShort'), m.firstEmptyMs !== null, m.longestDark ? fmtDateTime(m.longestDark.startMs, lang, tz) : undefined)}
            {cell('energy', 'batteryHours', fmtHours(m.batteryHours), t('hShort'), false)}
            {cell('energy', 'minBattery', fmtNum(m.minSocPct), '%', m.minSocPct <= 0, fmtDateTime(m.minSocAtMs, lang, tz))}
            {cell('earth', 'longestBlackout', fmtHours(hours(m.longestBlackout)), t('hShort'), hours(m.longestBlackout) > limits.maxBlackoutH)}
            {cell('energy', 'peakPower', fmtNum(m.peakPowerW), 'W', false)}
            {cell('terrain', 'worstSlope', fmtNum(a.landing.maxSlopeDeg, 1), '°', !a.landing.safe)}
          </div>
          <p className="cap mono">{t('slope.necessaryNotSufficient')}</p>

          <div className="block">
            <h2 className="h2">{t('outages')}</h2>
            <div className="grid2"><OutageList runs={m.darkRuns} kind="sun" /><OutageList runs={m.blackoutRuns} kind="earth" /></div>
          </div>
          <div className="block">
            <h2 className="h2">{t('dates')}</h2>
            <Timeline eph={data.eph} horizon={a.horizon} site={site} />
          </div>
          <div className="block">
            <h2 className="h2">{t('timeline')}</h2>
            <div className="stack-charts">
              {(['sun', 'earth', 'soc'] as Factor[]).map((k) => (
                <div key={k}><span className="label mono">{t(k === 'sun' ? 'chart.sunEl' : k === 'earth' ? 'chart.earthEl' : 'chart.soc')}</span><SeriesChart m={m} kind={k} minEarth={limits.minEarthElDeg} height={130} /></div>
              ))}
            </div>
          </div>
          <div className="grid2 block">
            <div><h2 className="h2">{t('events')}</h2><Events m={m} /></div>
            <div><h2 className="h2">{t('skyTitle')}</h2><Sky a={a} m={m} /><p className="cap mono">{t('skyNote')}</p></div>
          </div>
        </>
      ) : null}

      <div className="block conf-summary">
        <h2 className="h2">{t('confidence.title')}</h2>
        <SourcesList />
        <button type="button" className="btn-text" onClick={() => setDrawer(true)}>{t('confidence.open')}</button>
      </div>
      </details>
      {explain && m ? <Explainer metric={explain} a={a} m={m} onClose={() => setExplain(null)} /> : null}
      {drawer ? <ConfidenceDrawer onClose={() => setDrawer(false)} /> : null}
    </section>
  );
}

function Explainer({ metric, a, m, onClose }: { metric: Metric; a: Analysis; m: MissionResult; onClose: () => void }) {
  const t = useT();
  const limits = usePlanner((s) => s.limits);
  return (
    <Sheet side title={t(`explainer.${metric}` as Key)} onClose={onClose}>
      <p>{t(`explainer.${metric}.body` as Key)}</p>
      {metric === 'solar' ? <><SeriesChart m={m} kind="sun" minEarth={limits.minEarthElDeg} /><OutageList runs={m.darkRuns} kind="sun" /></> : null}
      {metric === 'earth' ? <><SeriesChart m={m} kind="earth" minEarth={limits.minEarthElDeg} /><OutageList runs={m.blackoutRuns} kind="earth" /></> : null}
      {metric === 'energy' ? <SeriesChart m={m} kind="soc" minEarth={limits.minEarthElDeg} /> : null}
      {metric === 'terrain' ? <div className="zone-result"><SectorRing sectors={a.landing.sectors} max={limits.maxSlopeDeg} /><Badge tone={a.landing.safe ? 'ok' : 'bad'}>{t(a.landing.safe ? 'safeLanding' : 'unsafeLanding')}</Badge></div> : null}
      <ConfidenceTable only={metric} />
    </Sheet>
  );
}

const EV: Record<string, { k: Key; i: IconName; c: string }> = {
  sunset: { k: 'evSunset', i: 'sun', c: 'sun' }, sunrise: { k: 'evSunrise', i: 'sun', c: 'sun' },
  earthset: { k: 'evEarthset', i: 'earth', c: 'earth' }, earthrise: { k: 'evEarthrise', i: 'earth', c: 'earth' },
  'battery-empty': { k: 'evEmpty', i: 'battery', c: 'bad' }, 'power-back': { k: 'evBack', i: 'battery', c: 'ok' },
};
function Events({ m }: { m: MissionResult }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const ev = majorEvents(m, 10);
  return (
    <ol className="ledger-list events">
      {ev.map((e, i) => <li key={i}><span className={`ev ${EV[e.kind]!.c}`}><Icon name={EV[e.kind]!.i} size={16} /></span><span>{t(EV[e.kind]!.k)}</span><b><bdi>{fmtDateTime(e.tMs, lang, tz)}</bdi></b></li>)}
      {ev.length === 0 ? <li className="muted">{t('noOutage')}</li> : null}
    </ol>
  );
}

/** 360° skyline from LOLA with the Sun and Earth paths over the mission (JPL Horizons). */
function Sky({ a, m }: { a: Analysis; m: MissionResult }) {
  const W = 720, H = 220, P = 32;
  const hz = a.horizon;
  let lo = Infinity, hi = -Infinity;
  for (const v of hz.el) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < m.t.length; i += 6) { lo = Math.min(lo, m.sunEl[i]!, m.earthEl[i]!); hi = Math.max(hi, m.sunEl[i]!, m.earthEl[i]!); }
  lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
  const x = (az: number) => P + (az / 360) * (W - P);
  const y = (el: number) => 8 + (1 - (el - lo) / (hi - lo)) * (H - 40);
  let ground = `M${x(0)},${y(lo)}`;
  for (let az = 0; az <= 360; az += 2) ground += ` L${x(az).toFixed(1)},${y(horizonAt(hz, az)).toFixed(1)}`;
  ground += ` L${x(360)},${y(lo)} Z`;
  const stride = Math.max(1, Math.floor(m.t.length / 160));
  const dots = (body: 'sun' | 'earth') => {
    const out = [];
    for (let i = 0; i < m.t.length; i += stride) {
      const vis = body === 'sun' ? m.sunFrac[i]! > 0 : m.earthMargin[i]! >= 0;
      out.push(<circle key={`${body}${i}`} cx={x(body === 'sun' ? m.sunAz[i]! : m.earthAz[i]!)} cy={y(body === 'sun' ? m.sunEl[i]! : m.earthEl[i]!)} r={body === 'sun' ? 2.4 : 2} className={`dot ${body}${vis ? '' : ' hid'}`} />);
    }
    return out;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart sky" role="img" aria-label="skyline" direction="ltr">
      {[lo, 0, hi].map((v) => <g key={v}><line x1={P} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? 'ref' : 'grid'} /><text x={P - 4} y={y(v) + 4} textAnchor="end" className="tick">{`${v}°`}</text></g>)}
      {dots('earth')}{dots('sun')}
      <path d={ground} className="ground" />
      {[0, 90, 180, 270, 360].map((az, i) => <text key={az} x={x(az)} y={H - 10} textAnchor="middle" className="tick">{['N', 'E', 'S', 'W', 'N'][i]}</text>)}
    </svg>
  );
}

// ---------------------------------------------------------------- 6 · Report
export function ReportStep({ data, a, alts }: { data: PlannerData; a: Analysis | null; alts?: readonly Candidate[] }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const site = usePlanner((s) => s.site);
  const dispersion = usePlanner((s) => s.dispersion);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const missionName = usePlanner((s) => s.missionName);
  const craftId = usePlanner((s) => s.craftId);
  const [copied, setCopied] = useState<'ok' | 'manual' | null>(null);
  const [now] = useState(() => Date.now());
  const link = `${location.origin}${location.pathname}${encodeMission({ site, dispersion, startMs, endMs, craft, limits })}`;
  const near = data.names.map((n) => ({ n, d: distanceAz(site, n) })).sort((x, y) => x.d.m - y.d.m)[0];
  const m = a && !('kind' in a.mission) ? a.mission : null;
  const battH = (craft.batteryWh * craft.usableFrac) / Math.max(1, craft.nightLoadW);
  const conf = useConfidence();
  const runs = (r: readonly { startMs: number; endMs: number }[]) => outageRows(r, 3).rows.map((x) => (
    <li key={x.startMs}><bdi>{fmtDateTime(x.startMs, lang, tz)}</bdi> {lang === 'ar' ? '←' : '→'} <bdi>{fmtDateTime(x.endMs, lang, tz)}</bdi> · <bdi>{fmtHours((x.endMs - x.startMs) / HOUR)}</bdi> {t('hShort')}</li>
  ));
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied('ok'); } catch { setCopied('manual'); } };
  const vd = a?.assessment.verdict;
  const vTone = vd === 'suitable' ? 'ok' : vd === 'conditional' ? 'warn' : vd === 'unsuitable' ? 'bad' : 'nodata';
  return (
    <section className="step narrow">
      <article className="report">
        <header className="rp-head">
          <div className="rp-brand"><MiniMoon size={30} /><b dir="ltr">SHADOWTRACE</b><span>{missionName || t('m.untitled')}</span></div>
          <div className={`rp-verdict ${a ? vTone : ''}`}>{a ? `${t(`v4.verdict.${a.assessment.verdict}` as Key)} · ${a.assessment.score}/100` : '…'}</div>
        </header>
        <div className="rp-grid">
          <div><span>{t('sumSite')}</span><b dir="ltr">{site.lat.toFixed(4)}°, {site.lon.toFixed(4)}°</b></div>
          <div><span>{t('sumNear')}</span><b>{near ? <><span dir="ltr">{near.n.name}</span> · <bdi>{fmtNum(near.d.m / 1000, 1)} km</bdi> {dirName(lang, near.d.az)}</> : '—'}</b></div>
          <div><span>{t('sumLand')}</span><b><bdi>{fmtDateTime(startMs, lang, tz)}</bdi></b></div>
          <div><span>{t('sumEnd')}</span><b><bdi>{fmtDateTime(endMs, lang, tz)}</bdi></b></div>
          <div><span>{t('sumDur')}</span><b><bdi>{fmtNum((endMs - startMs) / (24 * HOUR), 1)}</bdi> {t('days')}</b></div>
          {m ? <div><span>{t('longestDark')}</span><b><bdi>{fmtHours(hours(m.longestDark))}</bdi> {t('hShort')}</b></div> : null}
        </div>
        {a ? <ul className="rp-sent">{a.assessment.findings.filter((f) => f.tone !== 'info').map((f) => <li key={f.code}>{findingText(t, lang, f)}</li>)}</ul> : null}
        {a ? <p className="rp-src">{t('v4.conf')}: {t(`v4.conf.${a.assessment.confidence}` as Key)} · {t('v4.coverage')}: <bdi>{fmtNum(a.assessment.coveragePct, 0)}%</bdi> · {t('v4.score.note')}</p> : null}
        {m ? (
          <div className="rp-grid two">
            <div><span>{t('sunOut')}</span>{m.darkRuns.length ? <ul>{runs(m.darkRuns)}</ul> : <em>{t('noOutage')}</em>}</div>
            <div><span>{t('earthOut')}</span>{m.blackoutRuns.length ? <ul>{runs(m.blackoutRuns)}</ul> : <em>{t('noOutage')}</em>}</div>
          </div>
        ) : null}
        <div className="rp-grid two">
          <div><span>{t('craftSum')}</span><b><bdi>{fmtNum(craft.batteryWh)} Wh</bdi> · {t('coversH', { h: fmtHours(battH) })} · <bdi>{fmtNum(craft.arrayAreaM2, 1)} m²</bdi> · {t('peakW', { w: fmtNum(SOLAR_CONSTANT_W_M2 * craft.arrayAreaM2 * craft.arrayEff) })}</b></div>
          <div><span>{t('marginSum')}</span><b dir="ltr">N {fmtNum(dispersion.northM)} · E {fmtNum(dispersion.eastM)} · S {fmtNum(dispersion.southM)} · W {fmtNum(dispersion.westM)} m · {fmtNum(limits.legSpanM, 1)} m · {fmtNum(limits.maxSlopeDeg)}°</b></div>
        </div>
        <div className="rp-craft">
          <img src={`${import.meta.env.BASE_URL}assets/spacecraft/${craftId === 'custom' ? 'explorer' : craftId}-perspective.webp`} alt="" />
          <div><span>{t('j.fleet')}</span><b>{craftId === 'custom' ? t('f.custom') : t(`f.${craftId}.name` as Key)}</b><em>{t('f.illustrative')}</em></div>
        </div>
        {alts && alts.length ? (
          <div className="rp-alts"><span>{t('a.title')}</span>
            <ol>{alts.map((c, i) => <li key={i}><b dir="ltr">{c.alt.site.lat.toFixed(3)}°, {c.alt.site.lon.toFixed(3)}°</b> · <bdi>{fmtNum(c.alt.distanceM / 1000, 1)} km</bdi> · {t(`v4.verdict.${c.verdict}` as Key)} · {c.score}/100</li>)}</ol>
          </div>
        ) : null}
        <div className="rp-conf">
          <span>{t('confidence.title')}</span>
          <ul>{conf.map((r) => <li key={r.metric}><b>{t(`explainer.${r.metric}` as Key)}</b> — {r.source} · {r.resolution}{r.missing !== t('conf.none') ? ` · ${r.missing}` : ''}</li>)}</ul>
        </div>
        <p className="rp-src">{t('sources.footer')} · {t('geometryNote')} · {t('slope.necessaryNotSufficient')}</p>
        <p className="rp-src">{t('generated')}: <bdi>{fmtDateTime(now, lang, 'utc')} UTC</bdi></p>
      </article>
      <div className="actions no-print">
        <button type="button" className="btn-primary" onClick={() => window.print()}><Icon name="print" size={18} /><span>{t('printPdf')}</span></button>
        <button type="button" className="btn-text" onClick={copy}><Icon name="link" size={18} />{copied === 'ok' ? t('copied') : t('copyLink')}</button>
      </div>
      {copied === 'manual' ? <input className="link-box no-print" readOnly dir="ltr" value={link} onFocus={(e) => e.currentTarget.select()} autoFocus /> : null}
      <SavedAssessments a={a} link={link} />
    </section>
  );
}
