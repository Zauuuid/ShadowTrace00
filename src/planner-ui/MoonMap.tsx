/**
 * South-pole map built directly on NASA Moon Trek WMTS tiles (south polar stereographic, the same projection as
 * src/planner/polar.ts). No mapping library: tiles are <img> elements, overlays are SVG in screen space.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { radiusTowards, type Dispersion } from '../planner/landing';
import { offset, toLatLon, toXY, type LatLon, type XY } from '../planner/polar';
import type { PlannerData } from '../data/data';
import { monthName } from '../state/format';
import { useT } from '../state/i18n';
import { usePlanner } from '../state/store';

const TREK = 'https://trek.nasa.gov/tiles/Moon/SP';
const DATA = `${import.meta.env.BASE_URL}data/`;
const ORIGIN = 1_095_930;
const RES0 = (2 * ORIGIN) / 256;

interface TileLayer {
  readonly id: string;
  readonly maxZ: number;
  readonly extentM: number;
  readonly recolor?: boolean;
  readonly opacity?: number;
}
const BASE: TileLayer = { id: 'LRO_WAC_Mosaic_SPole60_100mp', maxZ: 4, extentM: 931_100 };
const NAC: TileLayer = { id: 'LRO_NAC_Mosaic_1mpp_SP', maxZ: 12, extentM: 136_700, recolor: true };
const EARTH: TileLayer = { id: 'AVGVISIB_85S_060M_201608_EARTH_SP', maxZ: 6, extentM: 151_740, recolor: true, opacity: 0.6 };
const PSR_TILES: TileLayer = { id: 'LRO_LOLA_Illumination_SPole65S_240m', maxZ: 3, extentM: 770_160, recolor: true, opacity: 0.7 };

export interface MapMarker {
  readonly id: string;
  readonly at: LatLon;
  readonly label: string;
  readonly tone: 'good' | 'bad' | 'info';
  readonly onClick?: () => void;
}

interface Props {
  readonly data: PlannerData;
  readonly site: LatLon;
  readonly onPick?: (p: LatLon) => void;
  readonly dispersion?: Dispersion;
  readonly highlight?: readonly string[];
  readonly markers?: readonly MapMarker[];
  readonly suggestion?: XY | null;
  readonly height?: number;
  readonly showLegend?: boolean;
  /** "YYYY-MM": month of the landing-suitability layer to draw. */
  readonly suitMonth?: string;
  readonly initialRes?: number;
  readonly tour?: string;
}

function Tiles({ layer, z, view, w, h }: { layer: TileLayer; z: number; view: { c: XY; res: number }; w: number; h: number }) {
  const zz = Math.min(z, layer.maxZ);
  const rz = RES0 / 2 ** zz;
  const span = 256 * rz;
  const x0 = view.c.x - (w / 2) * view.res, x1 = view.c.x + (w / 2) * view.res;
  const y0 = view.c.y - (h / 2) * view.res, y1 = view.c.y + (h / 2) * view.res;
  const c0 = Math.floor((Math.max(x0, -layer.extentM) + ORIGIN) / span);
  const c1 = Math.floor((Math.min(x1, layer.extentM) + ORIGIN) / span);
  const r0 = Math.floor((ORIGIN - Math.min(y1, layer.extentM)) / span);
  const r1 = Math.floor((ORIGIN - Math.max(y0, -layer.extentM)) / span);
  const size = span / view.res;
  const out = [];
  for (let r = Math.max(0, r0); r <= r1; r++) {
    for (let c = Math.max(0, c0); c <= c1; c++) {
      const left = (-ORIGIN + c * span - x0) / view.res;
      const top = (y1 - (ORIGIN - r * span)) / view.res;
      const src = `${TREK}/${layer.id}/1.0.0//default/default028mm/${zz}/${r}/${c}.png`;
      const style = { left, top, width: size + 0.5, height: size + 0.5, opacity: layer.opacity ?? 1 };
      out.push(layer.recolor
        ? <RecolorTile key={`${zz}/${r}/${c}`} src={src} style={style} mode={layer === PSR_TILES ? 'psr' : layer === NAC ? 'cut' : 'heat'} />
        : <img key={`${zz}/${r}/${c}`} className="tile" src={src} alt="" draggable={false} style={style} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />);
    }
  }
  return <>{out}</>;
}

/** NASA grey-scale layers recoloured like a weather map: red = little, green = a lot. */
function RecolorTile({ src, style, mode }: { src: string; style: React.CSSProperties; mode: 'psr' | 'heat' | 'cut' }) {
  const psr = mode === 'psr';
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cv = ref.current;
      if (!cv) return;
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, 256, 256);
      const d = g.getImageData(0, 0, 256, 256);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const v = p[i]! / 255;
        const a = p[i + 3]!;
        if (mode === 'cut') { if (p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 0) p[i + 3] = 0; continue; }
        if (a === 0 || (psr && v < 0.5)) { p[i + 3] = 0; continue; }
        if (psr) { p[i] = 235; p[i + 1] = 70; p[i + 2] = 70; p[i + 3] = 200; continue; }
        // red (0) -> amber (0.5) -> green (1)
        const r = v < 0.5 ? 232 : Math.round(232 - (v - 0.5) * 2 * 150);
        const gg = v < 0.5 ? Math.round(80 + v * 2 * 110) : Math.round(190 + (v - 0.5) * 2 * 30);
        p[i] = r; p[i + 1] = gg; p[i + 2] = 90; p[i + 3] = 170;
      }
      g.putImageData(d, 0, 0);
    };
    img.src = src;
  }, [src, psr, mode]);
  return <canvas ref={ref} className="tile" width={256} height={256} style={style} />;
}

export function MoonMap({ data, site, onPick, dispersion, highlight = [], markers = [], suggestion, height = 560, showLegend, suitMonth, initialRes = 120, tour }: Props) {
  const t = useT();
  const layers = usePlanner((s) => s.layers);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const siteXY = useMemo(() => toXY(site), [site]);
  const [view, setView] = useState<{ c: XY; res: number }>({ c: siteXY, res: initialRes });
  const lang = usePlanner((s) => s.lang);
  const drag = useRef<{ x: number; y: number; c: XY; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const h = height;
  // Recentre when the site changes from outside the map (lists, inputs) and is no longer comfortably in view.
  const [lastSite, setLastSite] = useState(siteXY);
  if (lastSite !== siteXY) {
    setLastSite(siteXY);
    const sx = (siteXY.x - view.c.x) / view.res, sy = (view.c.y - siteXY.y) / view.res;
    if (Math.abs(sx) > w * 0.38 || Math.abs(sy) > h * 0.38) setView((v) => ({ ...v, c: siteXY }));
  }
  const z = Math.max(0, Math.ceil(Math.log2(RES0 / view.res)));
  const toScreen = (q: XY) => ({ x: (q.x - view.c.x) / view.res + w / 2, y: (view.c.y - q.y) / view.res + h / 2 });
  const toWorld = (sx: number, sy: number): XY => ({ x: view.c.x + (sx - w / 2) * view.res, y: view.c.y - (sy - h / 2) * view.res });

  const zoomAt = (factor: number, sx = w / 2, sy = h / 2) => {
    setView((v) => {
      const res = Math.min(2000, Math.max(1.5, v.res * factor));
      const wx = v.c.x + (sx - w / 2) * v.res, wy = v.c.y - (sy - h / 2) * v.res;
      return { res, c: { x: wx - (sx - w / 2) * res, y: wy + (sy - h / 2) * res } };
    });
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY > 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const down = (e: RPE) => { drag.current = { x: e.clientX, y: e.clientY, c: view.c, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const move = (e: RPE) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, c: { x: d.c.x - dx * v.res, y: d.c.y + dy * v.res } }));
  };
  const up = (e: RPE) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && onPick) {
      const r = box.current!.getBoundingClientRect();
      const p = toLatLon(toWorld(e.clientX - r.left, e.clientY - r.top));
      if (p.lat <= data.terrain.minLatDeg) onPick(p);
    }
  };

  const zone = useMemo(() => {
    if (!dispersion) return '';
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 6) {
      const q = toScreen(offset(siteXY, a, radiusTowards(dispersion, a)));
      pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
    }
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispersion, siteXY, view, w, h]);

  const names = data.names.filter((n) => n.lat <= -74.5 && ((n.diameterKm * 1000) / view.res > 36 || highlight.includes(n.name)));
  const s = toScreen(siteXY);
  const suit = data.suit;
  const suitImg = (() => {
    if (!layers.suit || !suit || !suitMonth || !suit.months.includes(suitMonth)) return null;
    const tl = toScreen({ x: -suit.extentM, y: suit.extentM });
    const size = (2 * suit.extentM) / view.res;
    return <image href={`${DATA}suit/${suitMonth}.png`} x={tl.x} y={tl.y} width={size} height={size} preserveAspectRatio="none" className="suit-img" />;
  })();

  const grid = useMemo(() => {
    if (!layers.grid) return null;
    const els = [];
    for (let lat = -89; lat >= Math.round(data.terrain.minLatDeg); lat--) {
      const r = Math.hypot(toXY({ lat, lon: 0 }).x, toXY({ lat, lon: 0 }).y) / view.res;
      const o = toScreen({ x: 0, y: 0 });
      els.push(<circle key={`lat${lat}`} cx={o.x} cy={o.y} r={r} className="grat" />);
      if (lat % 2 === 0) els.push(<text key={`lt${lat}`} x={o.x + 4} y={o.y - r - 3} className="grat-l">{`${-lat}°S`}</text>);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const a = toScreen({ x: 0, y: 0 }), b = toScreen(toXY({ lat: data.terrain.minLatDeg, lon }));
      els.push(<line key={`lon${lon}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="grat" />);
    }
    return els;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.grid, view, w, h]);

  return (
    <div className="map" data-tour={tour} ref={box} style={{ height: h }} onPointerDown={down} onPointerMove={move} onPointerUp={up} role="application" aria-label={t('tapMap')}>
      <Tiles layer={BASE} z={z} view={view} w={w} h={h} />
      {layers.detail && view.res < 600 ? <Tiles layer={NAC} z={z} view={view} w={w} h={h} /> : null}
      {layers.earth ? <Tiles layer={EARTH} z={z} view={view} w={w} h={h} /> : null}
      {layers.psr ? <Tiles layer={PSR_TILES} z={z} view={view} w={w} h={h} /> : null}
      <svg className="map-svg" width={w} height={h}>
        {suitImg}
        {grid}
        {data.vectors.artemis3.features.map((f) => {
              const pts = f.rings[0]!.map(([x, y]) => toScreen({ x: x!, y: y! }));
              const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
              return (
                <g key={f.label}>
                  <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="a3" />
                  <text x={cx} y={cy} className="a3-l" textAnchor="middle">{f.label}</text>
                </g>
              );
            })}
        {names.map((n) => {
          const q = toScreen(toXY(n));
          const on = highlight.includes(n.name);
          return (
            <g key={n.name} className={on ? 'nm on' : 'nm'}>
              {on ? <circle cx={q.x} cy={q.y} r={Math.max(10, (n.diameterKm * 500) / view.res)} className="nm-ring" /> : null}
              <text x={q.x} y={q.y} textAnchor="middle" dominantBaseline="middle">{n.name}</text>
            </g>
          );
        })}
        {zone ? <polygon points={zone} className="zone" /> : null}
        {suggestion ? (() => { const q = toScreen(suggestion); return <g><line x1={s.x} y1={s.y} x2={q.x} y2={q.y} className="sugg" /><circle cx={q.x} cy={q.y} r={7} className="sugg-pt" /></g>; })() : null}
        {markers.map((m) => {
          const q = toScreen(toXY(m.at));
          return (
            <g key={m.id} className={`mk ${m.tone}`} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => { e.stopPropagation(); m.onClick?.(); }} style={{ cursor: m.onClick ? 'pointer' : 'default' }}>
              <circle cx={q.x} cy={q.y} r={14} />
              <text x={q.x} y={q.y} textAnchor="middle" dominantBaseline="central">{m.label}</text>
            </g>
          );
        })}
        <g className="pin" transform={`translate(${s.x},${s.y})`}>
          <circle r={10} />
          <circle r={3.5} className="pin-c" />
        </g>
      </svg>
      <div className="map-ctrl">
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomAt(0.5)} aria-label="+">+</button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomAt(2)} aria-label="−">−</button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setView((v) => ({ ...v, c: siteXY }))} aria-label="◎">◎</button>
      </div>
      <div className="map-scale" dir="ltr">{scaleLabel(view.res)}</div>
      {showLegend && suitImg ? (
        <div className="map-legend suit" data-tour="map-legend">
          <span className="sw good" />{t('suitGood')}<span className="sw mid" />{t('suitMid')}<span className="sw bad" />{t('suitBad')}
          {suitMonth ? <em>· {t('guideMonth', { m: `${monthName(Number(suitMonth.slice(5)) - 1, lang)} ${suitMonth.slice(0, 4)}` })}</em> : null}
        </div>
      ) : showLegend && layers.earth ? <div className="map-legend"><span className="lg-bar" />{t('legendEarth')}</div> : null}
      <div className="map-credit" dir="ltr">NASA Moon Trek · LRO WAC/NAC</div>
    </div>
  );
}

function scaleLabel(res: number): string {
  const m = res * 100;
  return m >= 1000 ? `▬ ${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `▬ ${Math.round(m)} m`;
}
