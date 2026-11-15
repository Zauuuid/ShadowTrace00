/**
 * v4 assessment views: verdict hero (5-second read), descent experience, findings, five-alternative comparison.
 * The descent animation draws exactly the touchdown samples the engine evaluated (uncertainty.ts) on the
 * slope map computed from the same LOLA heights — it can never show a success the assessment does not report.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerData } from '../data/data';
import { useAlternatives } from '../hooks/useAlternatives';
import type { Analysis } from '../hooks/useAnalysis';
import type { DateAlternative } from '../planner/alternatives';
import type { Assessment, Finding, FactorStatus, Verdict } from '../planner/assess';
import { evaluateCandidates, type Candidate, type CandidateSet } from '../planner/candidates';
import { radiusTowards, slopeAt } from '../planner/landing';
import { hours } from '../planner/mission';
import { distanceAz, offset, toXY } from '../planner/polar';

const D = Math.PI / 180;
import { fmtDate, fmtDateTime, fmtHours, fmtNum } from '../state/format';
import { dirName, useT, type Key } from '../state/i18n';
import { usePlanner, type Lang } from '../state/store';
import { Icon, Skeleton } from './widgets';

type T = ReturnType<typeof useT>;

// ---------------------------------------------------------------- text helpers
const PCT = new Set(['p', 'lo', 'hi', 'req', 'pct', 'soc', 'sun', 'b']);
const HRS = new Set(['dark', 'batt', 'h', 'max']);
function fmtParam(code: string, k: string, v: number | string, lang: Lang): string {
  if (typeof v === 'string') return v;
  if (k === 't') return fmtDateTime(v, lang, usePlanner.getState().tz);
  if (k === 'b' && code === 'data.240') return fmtNum(v);
  if (PCT.has(k)) return fmtNum(v, v >= 100 ? 0 : v >= 99 || v < 10 ? 1 : 0);
  if (k === 'max' && (code === 'td.low' || code === 'worst.slope')) return fmtNum(v, 1);
  if (HRS.has(k)) return fmtHours(v);
  if (k === 's') return fmtNum(v, 1);
  if (k === 'km') return fmtNum(v, v < 10 ? 1 : 0);
  return fmtNum(v);
}
export function findingText(t: T, lang: Lang, f: Finding, prefix = 'fd.'): string {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.p)) vars[k] = fmtParam(f.code, k, v, lang);
  return t(`${prefix}${f.code}` as Key, vars);
}

const VERDICT_TONE: Record<Verdict, 'ok' | 'warn' | 'bad' | 'nodata'> = { suitable: 'ok', conditional: 'warn', unsuitable: 'bad', insufficient: 'nodata' };
const VERDICT_ICON = { suitable: 'check', conditional: 'warn', unsuitable: 'cross', insufficient: 'question' } as const;
const FACTOR_ICON = { terrain: 'lander', power: 'sun', comms: 'earth', thermal: 'shadow' } as const;
const STATUS_TONE: Record<FactorStatus, string> = { pass: 'ok', watch: 'warn', fail: 'bad', na: 'nodata' };
const TONE_ICON = { ok: 'check', warn: 'warn', bad: 'cross', info: 'info' } as const;

// ---------------------------------------------------------------- verdict hero
export function VerdictHero({ a, busy }: { a: Analysis; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const s: Assessment = a.assessment;
  const tone = VERDICT_TONE[s.verdict];
  const top = s.findings.filter((f) => f.tone !== 'info').slice(0, 3);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className={`v4-hero ${tone}${busy ? ' busy' : ''}`} aria-live="polite">
      <div className="v4-hero-main">
        <p className="kicker mono"><bdi dir="ltr">{site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°</bdi> · <bdi>{fmtDate(startMs, lang, tz)}</bdi></p>
        <h2 className="v4-word"><Icon name={VERDICT_ICON[s.verdict]} size={40} />{t(`v4.verdict.${s.verdict}` as Key)}</h2>
        <p className="v4-lead">{t(`v4.lead.${s.verdict}` as Key)}</p>
        <ul className="v4-top">
          {top.map((f) => <li key={f.code} className={f.tone}><Icon name={TONE_ICON[f.tone]} size={18} /><span>{findingText(t, lang, f)}</span></li>)}
        </ul>
        {busy ? <p className="mono small muted">{t('recomputing')}…</p> : null}
      </div>
      <div className="v4-hero-side">
        <div className="v4-score" title={t('v4.score.note')}>
          <svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true">
            <circle cx="40" cy="40" r={R} className="ring-bg" />
            <circle cx="40" cy="40" r={R} className="ring-fg" strokeDasharray={`${(C * s.score) / 100} ${C}`} transform="rotate(-90 40 40)" />
          </svg>
          <b className="num">{s.score}</b>
          <span className="label mono">{t('v4.score')}</span>
        </div>
        <dl className="v4-meta">
          <div><dt className="label mono">{t('v4.conf')}</dt><dd className={`conf-${s.confidence}`}>{t(`v4.conf.${s.confidence}` as Key)}</dd></div>
          <div><dt className="label mono">{t('v4.coverage')}</dt><dd><bdi>{fmtNum(s.coveragePct, s.coveragePct >= 99.95 ? 0 : 1)}%</bdi></dd></div>
        </dl>
        <p className="cap mono">{t('v4.score.note')}</p>
      </div>
      <ul className="v4-factors">
        {s.factors.map((f) => (
          <li key={f.id} className={STATUS_TONE[f.status]}>
            <Icon name={FACTOR_ICON[f.id]} size={18} />
            <span className="f-name">{t(`v4.f.${f.id}` as Key)}</span>
            <span className="f-bar" aria-hidden="true"><i style={{ width: `${f.score ?? 0}%` }} /></span>
            <span className="f-status mono">{t(`v4.s.${f.status}` as Key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FindingsList({ s }: { s: Assessment }) {
  const t = useT();
  const lang = usePlanner((st) => st.lang);
  return (
    <ul className="v4-findings">
      {s.findings.map((f) => <li key={f.code} className={f.tone}><Icon name={TONE_ICON[f.tone]} size={16} /><span>{findingText(t, lang, f)}</span></li>)}
    </ul>
  );
}

// ---------------------------------------------------------------- descent experience
interface Raster { nx: number; ny: number; halfM: number; cell: number; slope: Float32Array; shade: Float32Array }

function useReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

const css = (name: string, fb: string) => (typeof getComputedStyle === 'undefined' ? fb : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);

export function Descent({ data, a }: { data: PlannerData; a: Analysis }) {
  const t = useT();
  const site = usePlanner((s) => s.site);
  const d = usePlanner((s) => s.dispersion);
  const limits = usePlanner((s) => s.limits);
  const req = usePlanner((s) => s.req);
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(560);
  const [run, setRun] = useState(0);
  const [shown, setShown] = useState(0);
  const craftId = usePlanner((s) => s.craftId);
  const td = a.touchdown;
  const total = td.points.length;
  const verdict = a.assessment.verdict;
  const craftImg = useMemo(() => { const i = new Image(); i.src = `${import.meta.env.BASE_URL}assets/spacecraft/${craftId === 'custom' ? 'explorer' : craftId}-top.webp`; return i; }, [craftId]);
  const rims = useMemo(() => data.names.filter((c) => c.kind === 'crater').map((c) => {
    const da = distanceAz(site, c);
    return { name: c.name, e: da.m * Math.sin(da.az * D), n: da.m * Math.cos(da.az * D), r: c.diameterKm * 500 };
  }), [data.names, site]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.min(760, el.clientWidth >= 1000 ? el.clientWidth - 340 : el.clientWidth));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  // Slope + hillshade raster from the same LOLA heights the engine used.
  const aspect = w < 520 ? 1 : 0.72;
  const raster = useMemo<Raster>(() => {
    const aim = toXY(site);
    const reach = Math.max(d.northM, d.eastM, d.southM, d.westM);
    const halfM = Math.max(reach * 1.5, 4 * td.gridM, 300); // half-size of the short (vertical) side
    const ny = 64, nx = Math.round(ny / aspect);
    const cell = (2 * halfM) / ny;
    const slope = new Float32Array(nx * ny), shade = new Float32Array(nx * ny), hgt = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const e = (i + 0.5 - nx / 2) * cell, nn = (ny / 2 - j - 0.5) * cell;
        const dist = Math.hypot(e, nn);
        const q = dist > 0 ? offset(aim, (Math.atan2(e, nn) * 180) / Math.PI, dist) : aim;
        slope[j * nx + i] = slopeAt(data.terrain, q, td.baselineM);
        hgt[j * nx + i] = data.terrain.heightAt(q);
      }
    }
    const h = (ii: number, jj: number) => hgt[Math.min(ny - 1, Math.max(0, jj)) * nx + Math.min(nx - 1, Math.max(0, ii))]!;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * cell), dy = (h(i, j - 1) - h(i, j + 1)) / (2 * cell);
        // low polar Sun from the north-west, exaggerated ×3 so 40 m relief reads on screen
        const nx3 = -3 * dx, ny3 = -3 * dy, len = Math.hypot(nx3, ny3, 1);
        shade[j * nx + i] = Number.isFinite(len) ? Math.max(0, (nx3 * -0.62 + ny3 * 0.62 + 0.48) / len) : 0;
      }
    }
    return { nx, ny, halfM, cell, slope, shade };
  }, [data.terrain, site, d, td.gridM, td.baselineM, aspect]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = w, H = Math.round(w * aspect);
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext('2d');
    if (!g) return;
    const col = { safe: css('--ok', '#78D6AE'), bad: css('--bad', '#E87570'), ice: css('--ice', '#65D8E8'), gold: css('--sun', '#C9A66B'), text: css('--text', '#DCE2E8'), muted: css('--muted', '#8D99A8'), bg: css('--bg-0', '#080C14') };
    const { nx, ny, halfM, slope, shade } = raster;
    const scale = H / (2 * halfM);
    const cx = W / 2, cy = H / 2;
    const px = (e: number, nn: number) => [cx + e * scale, cy - nn * scale] as const;
    // Offscreen terrain image
    const img = document.createElement('canvas');
    img.width = nx; img.height = ny;
    const ig = img.getContext('2d')!;
    const id = ig.createImageData(nx, ny);
    for (let k = 0; k < nx * ny; k++) {
      const s = slope[k]!, sh = shade[k]!;
      const base = 14 + 150 * sh ** 1.25;
      let r = base, gg = base * 1.04, b = base * 1.12;
      if (Number.isFinite(s)) {
        const over = Math.max(0, Math.min(1, (s - limits.maxSlopeDeg * 0.6) / (limits.maxSlopeDeg * 0.4)));
        if (s > limits.maxSlopeDeg) { r = r * 0.45 + 232 * 0.55; gg = gg * 0.45 + 117 * 0.55; b = b * 0.45 + 112 * 0.55; }
        else if (over > 0) { r = r * (1 - over * 0.3) + 232 * over * 0.3; gg = gg * (1 - over * 0.3) + 182 * over * 0.3; b = b * (1 - over * 0.3) + 90 * over * 0.3; }
      } else { r = gg = b = 18; }
      id.data.set([r, gg, b, 255], k * 4);
    }
    ig.putImageData(id, 0, 0);

    const ellipse = (k: number) => {
      g.beginPath();
      for (let az = 0; az <= 360; az += 3) {
        const rr = radiusTowards(d, az) * (k / req.sigmaLevel);
        const [x, y] = px(rr * Math.sin((az * Math.PI) / 180), rr * Math.cos((az * Math.PI) / 180));
        if (az === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    };
    const DUR_APPROACH = 1300, DUR_RAIN = 2600, DUR_SETTLE = 600;
    const T = DUR_APPROACH + DUR_RAIN + DUR_SETTLE;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const el = reduced ? T : now - t0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = true;
      g.drawImage(img, 0, 0, W, H);
      // named crater rims (IAU) crossing the view
      g.setLineDash([6, 6]); g.lineWidth = 1.2; g.strokeStyle = 'rgba(154,140,214,.85)'; g.fillStyle = 'rgba(154,140,214,.95)'; g.font = '600 11px "JetBrains Mono Variable", ui-monospace, monospace'; g.textAlign = 'left';
      const halfW = W / 2 / scale, halfH = H / 2 / scale;
      for (const c of rims) {
        const dc = Math.hypot(c.e, c.n);
        if (dc - c.r > Math.hypot(halfW, halfH) || dc + c.r < 0 || (dc < c.r - Math.hypot(halfW, halfH))) continue;
        const [x, y] = px(c.e, c.n);
        g.beginPath(); g.arc(x, y, c.r * scale, 0, Math.PI * 2); g.stroke();
        const ang = Math.atan2(cy - y, cx - x), lx0 = x + Math.cos(ang) * c.r * scale, ly0 = y + Math.sin(ang) * c.r * scale;
        if (lx0 > 10 && lx0 < W - 80 && ly0 > 16 && ly0 < H - 30) g.fillText(c.name, lx0 + 6, ly0 - 6);
      }
      g.setLineDash([]);
      // sigma rings
      g.setLineDash([4, 5]); g.lineWidth = 1; g.strokeStyle = 'rgba(101,216,232,.35)';
      for (let k = 1; k < req.sigmaLevel; k++) { ellipse(k); g.stroke(); }
      g.setLineDash([]); g.lineWidth = 1.6; g.strokeStyle = col.ice; ellipse(req.sigmaLevel); g.stroke();
      // approach track (bowling-lane simplicity: one clear line into the target)
      const pA = Math.min(1, el / DUR_APPROACH);
      const startY = -H * 0.15, endY = cy;
      g.setLineDash([2, 6]); g.strokeStyle = 'rgba(201,166,107,.55)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx - W * 0.28, startY); g.quadraticCurveTo(cx - W * 0.1, cy * 0.4, cx, endY); g.stroke(); g.setLineDash([]);
      // touchdowns
      const pR = Math.max(0, Math.min(1, (el - DUR_APPROACH) / DUR_RAIN));
      const k = Math.floor(pR * total);
      let safe = 0;
      for (let i = 0; i < k; i++) {
        const p = td.points[i]!;
        const [x, y] = px(p.e, p.n);
        g.fillStyle = p.cause === 'ok' ? col.safe : p.cause === 'slope' ? col.bad : col.muted;
        if (p.cause === 'ok') safe++;
        const age = (pR * total - i) / 12;
        const r = age < 1 ? 1.6 + (1 - age) * 3 : 1.8;
        g.globalAlpha = age < 1 ? 0.5 + age * 0.5 : 0.9;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      // lander (top-down glyph), descending along the track, shadow tightening
      const u = 1 - (1 - pA) ** 3;
      const lx = cx - W * 0.28 * (1 - u) * (1 - u) + 0, ly = startY + (endY - startY) * u;
      const alt = 1 - Math.min(1, el / (DUR_APPROACH + DUR_RAIN));
      // Outcome never contradicts the assessment: an Unsuitable plan ends hovering with an abort ring.
      const done = el >= T;
      const abort = verdict === 'unsuitable' || verdict === 'insufficient';
      const hover = abort ? Math.max(alt, 0.35) : alt;
      const size = 30 + 46 * hover;
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(lx + 10 * hover, ly + 16 * hover, size * 0.42, size * 0.42, 0, 0, Math.PI * 2); g.fill();
      if (craftImg.complete && craftImg.naturalWidth) g.drawImage(craftImg, lx - size / 2, ly - size / 2 - (abort && done ? 14 : 0), size, size);
      if (done) {
        const tone = verdict === 'suitable' ? col.safe : verdict === 'conditional' ? '#E0A84F' : col.bad;
        g.strokeStyle = tone; g.lineWidth = 2; g.setLineDash(abort ? [5, 5] : []);
        g.beginPath(); g.arc(cx, cy, size * 0.75, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      // target cross
      g.strokeStyle = col.text; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx, cy - 6); g.lineTo(cx, cy + 6); g.stroke();
      // north arrow + scale bar (map is drawn north-up, east-right in every language)
      g.fillStyle = col.text; g.font = '600 11px "JetBrains Mono Variable", ui-monospace, monospace'; g.textAlign = 'center';
      g.beginPath(); g.moveTo(W - 22, 14); g.lineTo(W - 27, 26); g.lineTo(W - 17, 26); g.closePath(); g.fill();
      g.fillText('N', W - 22, 40);
      const nice = [50, 100, 200, 250, 500, 1000, 2000].find((m) => m * scale > W * 0.16) ?? 2000;
      g.fillRect(14, H - 18, nice * scale, 2);
      g.textAlign = 'left'; g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 14, H - 24);
      setShown((prev) => (prev === safe + total * 0 + k * 100000 ? prev : k * 100000 + safe));
      if (!reduced && el < T) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [raster, w, aspect, run, reduced, td, total, d, req.sigmaLevel, limits.maxSlopeDeg, rims, craftImg, verdict]);

  const k = Math.floor(shown / 100000), safeNow = shown % 100000;
  const done = k >= total;
  const phase = done ? 'assess' : k > 0 ? (k > total * 0.85 ? 'touch' : 'descent') : 'approach';
  return (
    <div className="v4-descent" ref={box}>
      <div className="descent-head">
        <div>
          <h2 className="h2">{t('v4.descent.title')}</h2>
          <p className="muted">{t('v4.descent.lead')}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setRun((r) => r + 1)} disabled={reduced}><Icon name="target" size={16} />{t('v4.replay')}</button>
      </div>
      <ol className="phases mono" aria-hidden="true">
        {(['approach', 'descent', 'touch', 'assess'] as const).map((p) => <li key={p} className={p === phase ? 'on' : ''}>{t(`v4.ph.${p}` as Key)}</li>)}
      </ol>
      <div className="descent-grid">
        <canvas ref={cv} role="img" aria-label={t('v4.descent.alt', { safe: td.safe, n: td.valid })} dir="ltr" />
        <TouchdownStats a={a} />
      </div>
      <div className="descent-foot">
        <p className="count mono" aria-live="polite">{done ? t('v4.count', { safe: td.safe, n: td.valid }) : t('v4.count', { safe: safeNow, n: k })}</p>
        {done ? <span className={`badge ${VERDICT_TONE[verdict]}`}><Icon name={VERDICT_ICON[verdict]} size={16} />{verdict === 'unsuitable' || verdict === 'insufficient' ? t('ld.abort') : verdict === 'conditional' ? t('ld.touchCaution') : t('ld.touch')}</span> : null}
      </div>
      <ul className="legend mono small">
        <li><i className="dot ok" />{t('v4.lg.safe')}</li>
        <li><i className="dot bad" />{t('v4.lg.slope')}</li>
        <li><i className="dot nodata" />{t('v4.lg.nodata')}</li>
        <li><i className="ring" />{t('v4.lg.ellipse', { k: req.sigmaLevel })}</li>
        <li><i className="sw" />{t('v4.lg.terrain')} · {td.gridM} m · {fmtNum(td.baselineM)} m</li>
        <li><i className="rim" />{t('ld.crater')}</li>
      </ul>
    </div>
  );
}

function TouchdownStats({ a }: { a: Analysis }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const limits = usePlanner((s) => s.limits);
  const req = usePlanner((s) => s.req);
  const td = a.touchdown;
  const pct = (v: number) => fmtNum(v * 100, v >= 1 ? 0 : v >= 0.99 || v < 0.1 ? 1 : 0);
  const row = (label: string, value: string, org: 'nasa' | 'calc' | 'user') => (
    <div><dt className="label mono">{label}</dt><dd><bdi>{value}</bdi><span className={`org ${org}`}>{t(`v4.org.${org}`)}</span></dd></div>
  );
  return (
    <dl className="td-stats">
      <div className="big"><dt className="label mono">{t('v4.c.footprint')}</dt><dd><b className="num">{pSafeText(td)}%</b><span className="mono small muted">95%: {pct(td.ci95[0])}–{pct(td.ci95[1])}%</span></dd></div>
      {row(lang === 'ar' ? 'متوسط الميل' : 'Mean slope', `${fmtNum(td.slopeMeanDeg, 1)}°`, 'calc')}
      {row(lang === 'ar' ? 'الميل (المئين 95)' : 'Slope, 95th percentile', `${fmtNum(td.slopeP95Deg, 1)}°`, 'calc')}
      {row(lang === 'ar' ? 'التضرس المحلي (المئين 95)' : 'Local relief, 95th pct', `${fmtNum(td.reliefP95M, 2)} m`, 'calc')}
      {row(lang === 'ar' ? 'حد الميل' : 'Slope limit', `${fmtNum(limits.maxSlopeDeg)}°`, 'user')}
      {row(lang === 'ar' ? 'المطلوب' : 'Required', `${fmtNum(req.minPSafe * 100, 1)}%`, 'user')}
      {row(lang === 'ar' ? 'شبكة التضاريس' : 'Terrain grid', `LOLA ${td.gridM} m · ${fmtNum(td.baselineM)} m`, 'nasa')}
    </dl>
  );
}

// ---------------------------------------------------------------- five alternatives
export interface CandidateState { readonly set5: CandidateSet | null; readonly dates: readonly DateAlternative[] | null; readonly searching: boolean; readonly wanted: boolean }

/** Alternatives search + Monte Carlo re-evaluation, cached per plan (shared by Decision, Alternatives and Report). */
export function useCandidates(data: PlannerData, a: Analysis | null, busy: boolean, force: boolean): CandidateState {
  const d = usePlanner((s) => s.dispersion);
  const limits = usePlanner((s) => s.limits);
  const req = usePlanner((s) => s.req);
  const verdict = a?.assessment.verdict;
  const wanted = verdict === 'unsuitable' || verdict === 'conditional' || (force && verdict === 'suitable');
  const { sites, dates, searching } = useAlternatives(data, a, busy, wanted);
  const m = a && !('kind' in a.mission) ? a.mission : null;
  const set5 = useMemo(() => {
    if (!a || !sites || !sites.length) return null;
    const base = m ? { darkH: hours(m.longestDark), blackoutH: hours(m.longestBlackout), minSocPct: m.minSocPct, pSafe: a.touchdown.pSafe } : null;
    return evaluateCandidates(data.terrain, sites, d, limits, req, base, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, data.terrain, d, limits, req, a?.key]);
  return { set5, dates, searching, wanted };
}

export const candidateTone = (c: Candidate) => VERDICT_TONE[c.verdict];

export function CandidateList({ st, open, onOpen }: { st: CandidateState; open: number | null; onOpen: (i: number | null) => void }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const set = usePlanner((s) => s.set);
  const { set5, dates, searching } = st;
  const items: readonly Candidate[] = set5?.items ?? [];
  return (
    <div className="v4-alts">
      {searching ? <Skeleton label={t('v4.alt.searching')} /> : null}
      {set5 && !searching && items.length < 5 ? <p className="note">{t('v4.alt.fewer', { n: items.length })}{set5.excluded ? ` ${t('v4.alt.excluded', { n: set5.excluded })}` : ''}</p> : null}
      {set5 && !searching && items.length > 0 && set5.passing === 0 ? <p className="note warn">{t('v4.alt.nonePass')}</p> : null}
      {!searching && !items.length ? <p className="muted">{t('a.none')}</p> : null}
      <ol className="cands">
        {items.map((c, i) => (
          <li key={i} className={`cand ${VERDICT_TONE[c.verdict]}${open === i ? ' open' : ''}`}>
            <button type="button" className="cand-head" aria-expanded={open === i} onClick={() => onOpen(open === i ? null : i)}>
              <span className="aim-n mono">{i + 1}</span>
              <span className="cand-title">
                <b><bdi>{fmtNum(c.alt.distanceM / 1000, c.alt.distanceM < 10_000 ? 1 : 0)}</bdi> {t('km')} {dirName(lang, c.alt.azDeg)}</b>
                <span className="mono small muted" dir="ltr">{c.alt.site.lat.toFixed(3)}°, {c.alt.site.lon.toFixed(3)}°</span>
              </span>
              <span className={`badge ${VERDICT_TONE[c.verdict]}`}><Icon name={VERDICT_ICON[c.verdict]} size={14} />{t(`v4.verdict.${c.verdict}` as Key)}</span>
            </button>
            <dl className="cand-metrics mono">
              <div><dt>{t('v4.c.footprint')}</dt><dd><bdi>{pSafeText(c.td)}%</bdi></dd></div>
              <div><dt>{t('v4.c.light')}</dt><dd><bdi>{fmtHours(c.alt.darkH)} {t('hShort')}</bdi></dd></div>
              <div><dt>{t('v4.c.comms')}</dt><dd><bdi>{fmtHours(c.alt.blackoutH)} {t('hShort')}</bdi></dd></div>
              <div><dt>{t('v4.c.battery')}</dt><dd><bdi>{fmtNum(c.alt.minSocPct)}%</bdi></dd></div>
              <div><dt>{t('v4.c.score')}</dt><dd>{c.score}</dd></div>
              <div><dt>{t('v4.c.conf')}</dt><dd>{t(`v4.conf.${c.confidence}` as Key)}</dd></div>
            </dl>
            {open === i ? (
              <div className="cand-body">
                <p className={`why ${c.reason.tone}`}><b>{t('v4.reason')}:</b> {findingText(t, lang, c.reason, '')}</p>
                <div className="pc">
                  <div><h4 className="label mono">{t('v4.pros')}</h4><ul>{c.pros.length ? c.pros.map((f) => <li key={f.code} className="ok"><Icon name="check" size={14} />{findingText(t, lang, f, '')}</li>) : <li className="muted">—</li>}</ul></div>
                  <div><h4 className="label mono">{t('v4.cons')}</h4><ul>{c.cons.length ? c.cons.map((f) => <li key={f.code} className={f.tone}><Icon name="warn" size={14} />{findingText(t, lang, f, '')}</li>) : <li className="muted">—</li>}</ul></div>
                </div>
                <button type="button" className="btn-primary" onClick={() => { set({ site: c.alt.site, page: 'decision' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>{t('v4.alt.rerun')}</span><Icon name="arrow" size={16} className="flip-rtl" /></button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {dates && dates.length ? (
        <div className="date-alts">
          <span className="label mono">{t('v4.datesAlt')}</span>
          <div className="chips">{dates.map((x) => <button key={x.shiftDays} type="button" className={x.passes ? 'chip ok' : 'chip'} onClick={() => set({ startMs: x.startMs, endMs: x.endMs, page: 'decision' })}>{t(x.shiftDays > 0 ? 'daysLater' : 'daysEarlier', { n: Math.abs(x.shiftDays) })} · <bdi>{fmtDate(x.startMs, lang, tz)}</bdi></button>)}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Touchdown safety without ever printing "100%": when every sample passes, show the 95% lower bound. */
export function pSafeText(td: { safe: number; valid: number; pSafe: number; ci95: readonly [number, number] }): string {
  if (td.valid > 0 && td.safe === td.valid) return `≥ ${fmtNum(td.ci95[0] * 100, 1)}`;
  const v = td.pSafe * 100;
  return fmtNum(v, v >= 99 || v < 10 ? 1 : 0);
}
