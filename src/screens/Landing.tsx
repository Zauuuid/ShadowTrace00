/**
 * Screen 05 — the landing environment. Macro: the interactive globe (rotate, zoom, tap to move the target, data layers,
 * real sunlight at the landing date from JPL Horizons). Close-up: the computed descent (Monte Carlo touchdowns on the
 * LOLA slope map, crater rims, uncertainty ellipse) plus a north–south LOLA terrain profile with the spacecraft and a
 * footprint-to-scale inset. All of it is recomputed whenever the site, spacecraft, date or uncertainty changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadEphemerisFile, type PlannerData } from '../data/data';
import { Globe, type GlobeLayers } from '../globe/Globe';
import type { Analysis } from '../hooks/useAnalysis';
import { bodyDirs, type Vec3 } from '../journey/keyframes';
import { offset, toXY } from '../planner/polar';
import { fmtNum } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';
import { Descent } from '../planner-ui/assessment';
import { Skeleton } from '../planner-ui/widgets';
import { suitMonthOf } from '../planner-ui/steps';
import { ASSETS, NextBar, ScreenHead, craftOf, inCoverage } from './common';

export function Landing({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const craftId = usePlanner((s) => s.craftId);
  const limits = usePlanner((s) => s.limits);
  const set = usePlanner((s) => s.set);
  const [layers, setLayers] = useState<GlobeLayers>({ relief: true, suit: false, psr: true, artemis: false });
  const [realSun, setRealSun] = useState(false);
  const [sun, setSun] = useState<Vec3 | null>(null);
  const [view, setView] = useState({ lat: site.lat, lon: site.lon, dist: 1.16 });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!realSun) { setSun(null); return; }
    let live = true;
    loadEphemerisFile().then((f) => { if (live) setSun(bodyDirs(f, new Date(startMs).toISOString()).sun); }, () => undefined);
    return () => { live = false; };
  }, [realSun, startMs]);
  const month = data.suit ? suitMonthOf(startMs) : null;
  const toggle = (k: keyof GlobeLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  return (
    <main id="main" className="screen landing">
      <ScreenHead kicker={t('nav.step', { n: 4 })} title={t('ld.title')} lead={t('ld.lead')} />
      <div className="landing-globe">
        <Globe data={data} view={view} onView={setView} sun={sun} layers={layers} suitMonth={month} label={t('ld.pick')}
          onPick={(p) => { if (inCoverage(data, p)) { setMsg(null); set({ site: p }); } else setMsg(t('m.outside', { name: `${p.lat.toFixed(2)}°` })); }}
          markers={[{ id: 'target', at: site, label: '', tone: 'target', onClick: () => setView({ lat: site.lat, lon: site.lon, dist: 1.03 }) }]} />
        <div className="globe-tools">
          <p className="label mono">{t('ld.layers')}</p>
          {(['relief', 'suit', 'psr', 'artemis'] as const).map((k) => (
            <button key={k} type="button" className={layers[k] ? 'chip on' : 'chip'} aria-pressed={layers[k]} onClick={() => toggle(k)}>{t(`ld.${k}` as Key)}</button>
          ))}
          <button type="button" className={realSun ? 'chip on sun' : 'chip'} aria-pressed={realSun} onClick={() => setRealSun(!realSun)}>{t('ld.sun')}</button>
          {msg ? <p className="note warn small" role="alert">{msg}</p> : <p className="small muted">{t('ld.pick')}</p>}
        </div>
      </div>

      <section className="closeup">
        <p className="eyebrow mono">{t('ld.close')}</p>
        {!a || busy ? <Skeleton label={t('recomputing')} /> : (
          <>
            {a.touchdown.valid > 0 ? <Descent data={data} a={a} /> : <p className="note warn">{t('fd.td.nodata')}</p>}
            <div className="closeup-row">
              <Profile data={data} a={a} />
              <FootprintInset craft={craftOf(craftId)} legSpanM={limits.legSpanM} gridM={a.touchdown.gridM} baselineM={a.touchdown.baselineM} />
            </div>
          </>
        )}
      </section>
      <NextBar back="mission" next={() => set({ page: 'decision' })} label={t('ld.analyze')} disabled={!a || busy} />
    </main>
  );
}

/** North–south LOLA profile through the target, with the spacecraft (side view) and touchdown ticks. */
function Profile({ data, a }: { data: PlannerData; a: Analysis }) {
  const t = useT();
  const site = usePlanner((s) => s.site);
  const d = usePlanner((s) => s.dispersion);
  const craftId = usePlanner((s) => s.craftId);
  const ref = useRef<HTMLCanvasElement>(null);
  const td = a.touchdown;
  const halfM = Math.max(Math.max(d.northM, d.southM) * 1.5, 4 * td.gridM, 300);
  const prof = useMemo(() => {
    const aim = toXY(site);
    const n = 160, out: number[] = [];
    for (let i = 0; i <= n; i++) { const m = -halfM + (2 * halfM * i) / n; out.push(data.terrain.heightAt(m === 0 ? aim : offset(aim, m > 0 ? 0 : 180, Math.abs(m)))); }
    return out;
  }, [data.terrain, site, halfM]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth, H = 220, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ok = prof.filter(Number.isFinite);
    if (!ok.length) return;
    const lo = Math.min(...ok), hi = Math.max(...ok), span = Math.max(20, hi - lo);
    const x = (i: number) => (i / (prof.length - 1)) * W;
    const y = (h: number) => H - 26 - ((h - lo) / span) * (H * 0.42);
    const ground = g.createLinearGradient(0, H * 0.4, 0, H);
    ground.addColorStop(0, '#2a3550'); ground.addColorStop(1, '#0e1730');
    g.fillStyle = ground; g.beginPath(); g.moveTo(0, H);
    prof.forEach((h, i) => g.lineTo(x(i), Number.isFinite(h) ? y(h) : H));
    g.lineTo(W, H); g.closePath(); g.fill();
    g.strokeStyle = '#D8DEE8'; g.lineWidth = 1.4; g.beginPath();
    prof.forEach((h, i) => (i ? g.lineTo(x(i), y(h)) : g.moveTo(x(i), y(h)))); g.stroke();
    // touchdown ticks along the north axis, coloured by the engine's verdict for each sample
    for (const p of td.points) {
      if (Math.abs(p.n) > halfM) continue;
      const i = Math.round(((p.n + halfM) / (2 * halfM)) * (prof.length - 1));
      const h = prof[i]!;
      g.fillStyle = p.cause === 'ok' ? '#5FC9A0' : p.cause === 'slope' ? '#C94F62' : '#7A859B';
      g.globalAlpha = 0.55; g.fillRect(x(i) - 0.75, y(h) + 3, 1.5, 7); g.globalAlpha = 1;
    }
    // spacecraft at the target (not to scale), hovering when the decision is Unsuitable
    const verdict = a.assessment.verdict;
    const hc = prof[Math.round((prof.length - 1) / 2)]!;
    const img = new Image();
    img.onload = () => {
      const s = 64, abort = verdict === 'unsuitable' || verdict === 'insufficient';
      const gy = y(hc) - s * (img.naturalHeight / img.naturalWidth) - (abort ? 46 : 0);
      g.drawImage(img, W / 2 - s / 2, gy, s, s * (img.naturalHeight / img.naturalWidth));
      g.fillStyle = abort ? '#C94F62' : verdict === 'conditional' ? '#E0A84F' : '#5FC9A0';
      g.font = '600 11px "JetBrains Mono Variable", ui-monospace, monospace'; g.textAlign = 'center';
      g.fillText(abort ? t('ld.abort') : verdict === 'conditional' ? t('ld.touchCaution') : t('ld.touch'), W / 2, gy - 8);
    };
    img.src = `${ASSETS}spacecraft/${craftOf(craftId)}-perspective.webp`;
    g.fillStyle = '#8C97AD'; g.font = '11px "JetBrains Mono Variable", ui-monospace, monospace'; g.textAlign = 'left';
    g.fillText(`S −${fmtNum(halfM)} m`, 6, H - 8); g.textAlign = 'right'; g.fillText(`N +${fmtNum(halfM)} m`, W - 6, H - 8);
    g.textAlign = 'left'; g.fillText(`${fmtNum(lo)}–${fmtNum(hi)} m`, 6, 14);
  }, [prof, td, halfM, a.assessment.verdict, craftId, t]);
  return (
    <figure className="profile">
      <canvas ref={ref} role="img" aria-label={t('ld.profile')} dir="ltr" />
      <figcaption className="cap mono">{t('ld.profile')}</figcaption>
    </figure>
  );
}

/** The lander's footprint drawn to scale inside one DEM cell: why boulders cannot be assessed. */
function FootprintInset({ craft, legSpanM, gridM, baselineM }: { craft: string; legSpanM: number; gridM: number; baselineM: number }) {
  const t = useT();
  const S = 180, k = S / gridM, r = (legSpanM / 2) * k;
  return (
    <figure className="fp-inset">
      <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img" aria-label={t('ld.footprint', { craft, s: fmtNum(legSpanM, 1), g: gridM })}>
        <rect x="0.5" y="0.5" width={S - 1} height={S - 1} className="cell" />
        <circle cx={S / 2} cy={S / 2} r={Math.max(1.5, r)} className="foot" />
        <text x="8" y="18" className="t">{gridM} m</text>
      </svg>
      <figcaption>
        <b>{t('ld.footprint', { craft: t(`f.${craft}.name` as Key), s: fmtNum(legSpanM, 1), g: gridM })}</b>
        <span className="small muted">{t('ld.footprintNote', { b: fmtNum(baselineM) })}</span>
      </figcaption>
    </figure>
  );
}
