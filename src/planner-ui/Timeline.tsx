/**
 * Mission timeline like a video editor. Main bar: Sun and Earth rows at the chosen site (JPL Horizons + LOLA horizon)
 * over a zoomable span, with two draggable handles for landing and mission end. Overview bar underneath: the whole
 * loaded range (Nov 2026 – Dec 2035) with a draggable window for the visible span. Time always runs left → right.
 */
import { useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { azEl, discFractionVisible, sunRadiusDeg, type Ephemeris } from '../planner/ephemeris';
import { horizonAt, type Horizon } from '../planner/horizon';
import type { LatLon } from '../planner/polar';
import { fmtDayTick, monthName } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPANS: readonly { days: number; key: Key; cols: number; sub: number }[] = [
  { days: 7, key: 'd7', cols: 168, sub: 1 },
  { days: 30, key: 'd30', cols: 360, sub: 1 },
  { days: 120, key: 'd120', cols: 480, sub: 2 },
  { days: 365, key: 'y1', cols: 365, sub: 4 },
];
const NUDGE = 15 * DAY;

interface Props {
  readonly eph: Ephemeris;
  readonly horizon: Horizon;
  readonly site: LatLon;
}

function useRows(eph: Ephemeris, horizon: Horizon, site: LatLon, minEarth: number, t0: number, span: number, cols: number, sub: number) {
  return useMemo(() => {
    const sun = new Float32Array(cols), earth = new Float32Array(cols);
    const step = span / cols;
    for (let c = 0; c < cols; c++) {
      let s = 0, e = 0;
      for (let k = 0; k < sub; k++) {
        const tm = Math.min(eph.endMs, Math.max(eph.startMs, t0 + c * step + (k + 0.5) * (step / sub)));
        const a = azEl(eph, 'sun', site, horizon.observerM, tm);
        s += discFractionVisible(a.el - horizonAt(horizon, a.az), sunRadiusDeg(a.km));
        const b = azEl(eph, 'earth', site, horizon.observerM, tm);
        e += b.el - horizonAt(horizon, b.az) >= minEarth ? 1 : 0;
      }
      sun[c] = s / sub;
      earth[c] = e / sub;
    }
    return { sun, earth };
  }, [eph, horizon, site, minEarth, t0, span, cols, sub]);
}

const sunColor = (v: number) => (v <= 0 ? '#0d1320' : `rgba(242,179,92,${0.25 + 0.75 * v})`);
const earthColor = (v: number) => (v <= 0 ? '#0d1320' : `rgba(127,184,230,${0.25 + 0.75 * v})`);

export function Timeline({ eph, horizon, site }: Props) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const minEarth = usePlanner((s) => s.limits.minEarthElDeg);
  const set = usePlanner((s) => s.set);
  const missionDays = (endMs - startMs) / DAY;
  const [spanIdx, setSpanIdx] = useState(() => {
    const i = SPANS.findIndex((s) => s.days >= missionDays * 1.2);
    return i === -1 ? SPANS.length - 1 : i;
  });
  const cfg = SPANS[spanIdx]!;
  const span = cfg.days * DAY;
  const [anchor, setAnchor] = useState<number | null>(null);
  const viewStart = Math.max(eph.startMs, Math.min(eph.endMs - span, anchor ?? startMs - span * 0.12));
  const main = useRef<SVGSVGElement>(null);
  const over = useRef<SVGSVGElement>(null);
  const drag = useRef<'start' | 'end' | 'window' | null>(null);
  const grab = useRef(0);

  const rows = useRows(eph, horizon, site, minEarth, viewStart, span, cfg.cols, cfg.sub);
  const fullSpan = eph.endMs - eph.startMs;
  const overview = useRows(eph, horizon, site, minEarth, eph.startMs, fullSpan, 500, 6);

  const W = 1000, LH = 30, PAD = 70;
  const x = (tm: number) => PAD + ((tm - viewStart) / span) * (W - PAD);
  const tAt = (px: number) => viewStart + ((px - PAD) / (W - PAD)) * span;
  const ox = (tm: number) => ((tm - eph.startMs) / fullSpan) * W;
  const otAt = (px: number) => eph.startMs + (px / W) * fullSpan;

  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const d0 = new Date(viewStart);
    if (cfg.days === 365) {
      for (let m = 0; m < 14; m++) {
        const tm = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
        if (tm >= viewStart && tm <= viewStart + span) out.push({ x: x(tm), label: `${monthName(new Date(tm).getUTCMonth(), lang)} ${new Date(tm).getUTCFullYear() % 100}` });
      }
    } else {
      const every = cfg.days === 7 ? 1 : cfg.days === 30 ? 2 : 7;
      for (let d = 0; d <= cfg.days; d += every) {
        const tm = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1 + d);
        if (tm >= viewStart && tm <= viewStart + span) out.push({ x: x(tm), label: fmtDayTick(tm, 'utc', lang) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart, cfg.days, lang]);

  const years = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let y = new Date(eph.startMs).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < eph.endMs; y++) out.push({ x: ox(Date.UTC(y, 0, 1)), y });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eph]);

  const snap = cfg.days <= 30 ? HOUR : DAY;
  const pxOf = (svgEl: SVGSVGElement | null, e: RPE) => {
    if (!svgEl) return 0;
    const r = svgEl.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  const moveMain = (e: RPE) => {
    if (drag.current !== 'start' && drag.current !== 'end') return;
    const tm = Math.round(tAt(pxOf(main.current, e)) / snap) * snap;
    const c = Math.max(eph.startMs, Math.min(eph.endMs, tm));
    if (drag.current === 'start') set({ startMs: Math.min(c, endMs - HOUR) });
    else set({ endMs: Math.max(c, startMs + HOUR) });
  };
  const moveOver = (e: RPE) => {
    if (drag.current !== 'window') return;
    setAnchor(otAt(pxOf(over.current, e)) - grab.current);
  };
  const stop = () => { drag.current = null; };

  const xs = x(startMs), xe = x(endMs);
  const cw = (W - PAD) / cfg.cols;
  const ow = W / overview.sun.length;
  const winX = ox(viewStart), winW = Math.max(6, ox(viewStart + span) - winX);

  return (
    <div className="timeline" data-tour="timeline">
      <div className="tl-head">
        <div className="seg" role="group" aria-label={t('viewSpan')}>
          {SPANS.map((s, i) => (
            <button key={s.key} type="button" aria-pressed={cfg === s} className={cfg === s ? 'on' : ''} onClick={() => { setSpanIdx(i); setAnchor(null); }}>{t(s.key)}</button>
          ))}
        </div>
        <div className="tl-nav" dir="ltr">
          <button type="button" aria-label="−15" onClick={() => setAnchor(viewStart - NUDGE)}>‹</button>
          <button type="button" aria-label="+15" onClick={() => setAnchor(viewStart + NUDGE)}>›</button>
        </div>
        <div className="tl-legend">
          <span><i style={{ background: '#F2B35C' }} />{t('sunUp')}</span>
          <span><i style={{ background: '#7FB8E6' }} />{t('earthUp')}</span>
          <span><i style={{ background: '#0d1320', outline: '1px solid rgba(190,208,226,.2)' }} />{t('sunDown')} / {t('earthDown')}</span>
        </div>
      </div>
      <svg ref={main} viewBox={`0 0 ${W} ${LH * 2 + 56}`} className="tl-svg" onPointerMove={moveMain} onPointerUp={stop} onPointerCancel={stop}>
        <text x={PAD - 10} y={24} textAnchor="end" className="tl-row">{t('sun')}</text>
        <text x={PAD - 10} y={24 + LH + 6} textAnchor="end" className="tl-row">{t('earth')}</text>
        {Array.from(rows.sun, (v, c) => <rect key={`s${c}`} x={PAD + c * cw} y={8} width={cw + 0.3} height={LH - 4} fill={sunColor(v)} />)}
        {Array.from(rows.earth, (v, c) => <rect key={`e${c}`} x={PAD + c * cw} y={8 + LH + 6} width={cw + 0.3} height={LH - 4} fill={earthColor(v)} />)}
        <rect x={Math.max(PAD, xs)} y={2} width={Math.max(0, Math.min(W, xe) - Math.max(PAD, xs))} height={LH * 2 + 14} className="tl-range" />
        {ticks.map((k) => <g key={k.x}><line x1={k.x} x2={k.x} y1={LH * 2 + 16} y2={LH * 2 + 22} className="tl-tick" /><text x={k.x} y={LH * 2 + 36} textAnchor="middle" className="tl-tl">{k.label}</text></g>)}
        {([['start', xs], ['end', xe]] as const).map(([which, px]) => (px >= PAD - 1 && px <= W + 1 ? (
          <g key={which} className="tl-handle" onPointerDown={(e) => { drag.current = which; main.current?.setPointerCapture?.(e.pointerId); }}>
            <rect x={px - 14} y={0} width={28} height={LH * 2 + 16} fill="transparent" />
            <line x1={px} x2={px} y1={0} y2={LH * 2 + 16} />
            <rect x={px - 9} y={LH - 6} width={18} height={26} rx={6} />
          </g>
        ) : null))}
      </svg>
      <svg ref={over} viewBox={`0 0 ${W} 46`} className="tl-over" data-tour="overview" onPointerMove={moveOver} onPointerUp={stop} onPointerCancel={stop}
        onPointerDown={(e) => {
          const px = pxOf(over.current, e);
          drag.current = 'window';
          grab.current = px >= winX && px <= winX + winW ? otAt(px) - viewStart : span / 2;
          if (!(px >= winX && px <= winX + winW)) setAnchor(otAt(px) - span / 2);
          over.current?.setPointerCapture?.(e.pointerId);
        }}>
        {Array.from(overview.sun, (v, c) => <rect key={`os${c}`} x={c * ow} y={4} width={ow + 0.3} height={12} fill={sunColor(v)} />)}
        {Array.from(overview.earth, (v, c) => <rect key={`oe${c}`} x={c * ow} y={18} width={ow + 0.3} height={12} fill={earthColor(v)} />)}
        <rect x={ox(startMs)} y={2} width={Math.max(2, ox(endMs) - ox(startMs))} height={30} className="tl-o-mission" />
        <rect x={winX} y={0} width={winW} height={34} rx={5} className="tl-o-window" />
        {years.map((y) => <g key={y.y}><line x1={y.x} x2={y.x} y1={32} y2={37} className="tl-tick" /><text x={y.x} y={45} textAnchor="middle" className="tl-tl">{y.y}</text></g>)}
      </svg>
      <div className="tl-foot">
        <span className="muted">{t('dragHint')}</span>
      </div>
    </div>
  );
}
