/**
 * One chart for the three factors, drawn from the engine's MissionResult arrays (no maths beyond scaling to pixels):
 * sun = Sun elevation above the terrain horizon (shaded = dark), earth = Earth elevation above the horizon
 * (hatched = outage below the minimum), soc = battery state of charge (line at 0 = empty).
 * `draw` makes the line and bands scrub-drawable by the Journey (pathLength = 1, clip rect).
 */
import { useId } from 'react';
import { hours, type MissionResult } from '../planner/mission';
import { fmtDayTick, fmtHours, fmtNum, monthName, tickPlan } from '../state/format';
import { useT } from '../state/i18n';
import { usePlanner } from '../state/store';

export type Factor = 'sun' | 'earth' | 'soc';
const W = 640, P = 44, TOP = 10;

export function SeriesChart({ m, kind, height = 160, draw, minEarth }: { m: MissionResult; kind: Factor; height?: number; draw?: boolean; minEarth: number }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const uid = useId().replace(/:/g, '');
  const n = m.t.length;
  const H = height - 30;
  const x = (i: number) => P + (i / Math.max(1, n - 1)) * (W - P - 6);
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    vals[i] = kind === 'sun' ? m.sunMargin[i]! : kind === 'earth' ? m.earthMargin[i]! : m.usableWh > 0 ? (100 * m.socWh[i]!) / m.usableWh : 0;
  }
  let lo = kind === 'soc' ? 0 : 0, hi = kind === 'soc' ? 100 : 1;
  if (kind !== 'soc') {
    for (const v of vals) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    lo = Math.max(-10, Math.floor(lo)); hi = Math.min(15, Math.ceil(hi));
  }
  const y = (v: number) => TOP + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)) * H;
  const stride = Math.max(1, Math.floor(n / 500));
  let d = '';
  for (let i = 0; i < n; i += stride) d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]!).toFixed(1)}`;
  d += `L${x(n - 1).toFixed(1)},${y(vals[n - 1]!).toFixed(1)}`;

  // Bands: darkness (Sun) or outage (Earth), as spans of steps.
  const bands: [number, number][] = [];
  if (kind !== 'soc') {
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && (kind === 'sun' ? m.sunFrac[i]! <= 0 : m.earthMargin[i]! < minEarth);
      if (on && s < 0) s = i;
      if (!on && s >= 0) { bands.push([s, i - 1]); s = -1; }
    }
  }
  const plan = tickPlan((m.t[n - 1]! - m.t[0]!) / 86_400_000);
  const ticks: { x: number; label: string }[] = [];
  const d0 = new Date(m.t[0]!);
  for (let k = 0; k < 400 && ticks.length < 9; k++) {
    const tm = plan.unit === 'day' ? Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1 + k * plan.every * (plan.every === 1 ? 2 : 1))
      : plan.unit === 'month' ? Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1 + k * plan.every, 1) : Date.UTC(d0.getUTCFullYear() + 1 + k, 0, 1);
    if (tm > m.t[n - 1]!) break;
    const label = plan.unit === 'day' ? fmtDayTick(tm, tz, lang) : plan.unit === 'month' ? `${monthName(new Date(tm).getUTCMonth(), lang)} ${new Date(tm).getUTCFullYear()}` : String(new Date(tm).getUTCFullYear());
    ticks.push({ x: x((tm - m.t[0]!) / m.stepMs), label });
  }
  const label = t(kind === 'sun' ? 'chart.sunEl' : kind === 'earth' ? 'chart.earthEl' : 'chart.soc');
  const summary = kind === 'sun' ? `${t('longestDark')}: ${fmtHours(hours(m.longestDark))} ${t('hShort')} · ${t('chart.dark')}: ${m.darkRuns.length}`
    : kind === 'earth' ? `${t('longestBlackout')}: ${fmtHours(hours(m.longestBlackout))} ${t('hShort')} · ${t('chart.outage')}: ${m.blackoutRuns.length}`
      : `${t('minBattery')}: ${fmtNum(m.minSocPct)}%`;
  const clipW = W - P;
  return (
    <figure className={`chart-fig ${kind}`}>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={`${label}. ${summary}`} direction="ltr">
        <defs>
          <clipPath id={`c${uid}`}><rect x={P} y={0} width={draw ? 0 : clipW} height={height} {...(draw ? { 'data-clip': clipW } : {})} /></clipPath>
          <pattern id={`h${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="hatch" /></pattern>
        </defs>
        <g clipPath={`url(#c${uid})`}>
          {bands.map(([a, b]) => <rect key={a} x={x(a)} y={TOP} width={Math.max(1, x(b) - x(a))} height={H} className={kind === 'sun' ? 'band-dark' : 'band-out'} fill={kind === 'earth' ? `url(#h${uid})` : undefined} />)}
        </g>
        <line x1={P} x2={W - 6} y1={TOP + H} y2={TOP + H} className="axis" />
        <line x1={P} x2={P} y1={TOP} y2={TOP + H} className="axis" />
        {kind !== 'soc' ? <line x1={P} x2={W - 6} y1={y(0)} y2={y(0)} className="ref" /> : <line x1={P} x2={W - 6} y1={y(0)} y2={y(0)} className="ref bad" />}
        {kind === 'earth' && minEarth !== 0 ? <line x1={P} x2={W - 6} y1={y(minEarth)} y2={y(minEarth)} className="ref dash" /> : null}
        <text x={P - 6} y={y(hi) + 4} className="tick" textAnchor="end">{kind === 'soc' ? '100%' : `${hi}°`}</text>
        <text x={P - 6} y={y(lo) + 4} className="tick" textAnchor="end">{kind === 'soc' ? '0%' : `${lo}°`}</text>
        {kind !== 'soc' && lo < 0 ? <text x={P - 6} y={y(0) + 4} className="tick" textAnchor="end">0°</text> : null}
        <path d={d} className={`series ${kind}`} pathLength={1} {...(draw ? { 'data-draw': '', strokeDasharray: 1, strokeDashoffset: 1 } : {})} />
        {ticks.map((k) => <text key={k.x} x={k.x} y={height - 6} className="tick" textAnchor="middle">{k.label}</text>)}
      </svg>
      <figcaption className="sr-summary">{summary}</figcaption>
    </figure>
  );
}
