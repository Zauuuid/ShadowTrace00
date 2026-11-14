/**
 * Act I — the Journey (chapter 04). DOM scenes scroll over one fixed canvas. Three.js / GSAP / Lenis load lazily
 * (runtime.ts). With reduced motion or no WebGL the same scenes render as plain sections with a static Moon (04 §8).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadEphemerisFile, type VectorLayers } from '../data/data';
import type { Analysis } from '../hooks/useAnalysis';
import type { EphemerisFile, } from '../planner/ephemeris';
import { SeriesChart } from '../planner-ui/charts';
import { Icon, Skeleton } from '../planner-ui/widgets';
import { fmtDateTime, fmtNum } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';
import { JOURNEY_DATE } from './keyframes';
import type { Runtime } from './runtime';

const BASE = import.meta.env.BASE_URL;
/** Scene heights (vh) proportional to the keyframe ranges over 800 vh of scroll + the last viewport. */
const HEIGHTS = [96, 168, 120, 160, 144, 212];
const SCENE_KEYS: readonly Key[] = ['scene.1', 'scene.2', 'scene.3', 'scene.4', 'scene.5', 'scene.6'];

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

interface Counts { rows: number; artemis: number; psr: number; resM: number }

export function Journey({ a, onPlanner }: { a: Analysis | null; onPlanner: () => void }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const site = usePlanner((s) => s.site);
  const minEarth = usePlanner((s) => s.limits.minEarthElDeg);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const ticksRef = useRef<HTMLSpanElement>(null);
  const labelBox = useRef<HTMLDivElement>(null);
  const rt = useRef<Runtime | null>(null);
  const [staticMode, setStaticMode] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches || !webglOk());
  const [glReady, setGlReady] = useState(false);
  const [counting, setCounting] = useState(false);
  const [eph, setEph] = useState<EphemerisFile | null>(null);
  const [vectors, setVectors] = useState<VectorLayers | null>(null);
  const [resM, setResM] = useState<number | null>(null);

  useEffect(() => {
    loadEphemerisFile().then(setEph, () => undefined);
    fetch(`${BASE}data/moontrek_vectors.json`).then((r) => r.json()).then(setVectors, () => undefined);
    fetch(`${BASE}data/dem40/meta.json`).then((r) => r.json()).then((m: { mapScaleM: number }) => setResM(m.mapScaleM), () => undefined);
  }, []);

  const counts: Counts | null = eph && vectors && resM ? { rows: eph.count, artemis: vectors.artemis3.features.length, psr: vectors.psr.features.length, resM } : null;

  // Start the animated runtime once the lighting (ephemeris) and vectors are here.
  useEffect(() => {
    if (staticMode || !eph || !vectors || !root.current || !canvas.current) return;
    let alive = true;
    let local: Runtime | null = null;
    import('./runtime').then(({ startJourney }) => {
      if (!alive || !root.current || !canvas.current) return;
      local = startJourney({
        root: root.current, canvas: canvas.current, rtl: lang === 'ar', eph, vectors,
        labels: Array.from(labelBox.current?.children ?? []) as HTMLElement[],
        onProgress: (p, s) => {
          if (counterRef.current) counterRef.current.textContent = `${String(s + 1).padStart(3, '0')} / 006 · ${t(SCENE_KEYS[s]!).toUpperCase()}`;
          if (ticksRef.current) ticksRef.current.style.setProperty('--p', p.toFixed(4));
        },
        onCount: () => setCounting(true),
        onReady: () => setGlReady(true),
        onFail: () => setStaticMode(true),
      });
      rt.current = local;
    }, () => setStaticMode(true));
    return () => { alive = false; local?.dispose(); rt.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticMode, eph, vectors, lang]);

  // Panels appear when the analysis arrives: re-bind their draw triggers.
  const m = a && !('kind' in a.mission) ? a.mission : null;
  useEffect(() => { rt.current?.refreshCharts(); }, [m]);

  const go = (sel: string) => {
    const el = root.current?.querySelector<HTMLElement>(sel);
    if (!el) return;
    if (rt.current) rt.current.scrollTo(el); else el.scrollIntoView({ behavior: staticMode ? 'auto' : 'smooth' });
  };
  const siteLabel = `${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`;
  const journeyDate = useMemo(() => `${fmtDateTime(Date.parse(JOURNEY_DATE), lang, 'utc')} UTC`, [lang]);
  const panels: [Key, Key, 'sun' | 'earth' | 'soc', Record<string, string>?][] = [
    ['journey.panelA', 'journey.panelA.cap', 'sun', { s: siteLabel }],
    ['journey.panelB', 'journey.panelB.cap', 'earth'],
    ['journey.panelC', 'journey.panelC.cap', 'soc'],
  ];

  return (
    <div className={staticMode ? 'journey static' : 'journey'} ref={root}>
      {!staticMode ? <canvas className="j-canvas" ref={canvas} aria-hidden="true" /> : null}
      <div className={glReady && !staticMode ? 'j-poster gone' : 'j-poster'} aria-hidden="true" style={{ backgroundImage: `url(${BASE}data/moon/color_2k.webp)` }} />
      {!staticMode ? <div className="j-labels" ref={labelBox} aria-hidden="true">{(vectors?.artemis3.features ?? []).map((f) => <span key={f.label} className="j-label mono">{f.label}</span>)}</div> : null}

      <div className="j-hud" aria-hidden={staticMode}>
        <span className="hud-scroll mono"><i />{t('hud.scroll')}</span>
        <span className="hud-src mono">
          <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">{t('hud.surfaceSource')}</a>
          <span>{t('hud.sunSource', { d: journeyDate })} · {t('hud.earthshine')}</span>
        </span>
        <span className="hud-count mono"><span ref={counterRef}>001 / 006 · {t('scene.1').toUpperCase()}</span><span className="ticks" ref={ticksRef} /></span>
      </div>
      <nav className="j-dots" aria-label="scenes">
        {SCENE_KEYS.map((k, i) => <button key={k} type="button" aria-label={t(k)} onClick={() => go(`[data-scene="${i + 1}"]`)} />)}
      </nav>

      <section data-scene="1" className="scene s1" style={{ '--h': `${HEIGHTS[0]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <div className="copy">
            <h1 className="display reveal">{t('journey.s1.title')}</h1>
            <p className="lede reveal">{t('journey.s1.sub')}</p>
            <div className="cta-row reveal">
              <button type="button" className="btn-primary" onClick={() => go('[data-scene="2"]')}><span>{t('journey.s1.cta')}</span><Icon name="arrow" size={18} className="flip-rtl" /></button>
              <button type="button" className="btn-text" onClick={onPlanner}>{t('skip.toPlanner')}</button>
            </div>
          </div>
          {staticMode ? <div className="static-moon" style={{ backgroundImage: `url(${BASE}data/moon/color_2k.webp)` }} role="img" aria-label={t('hud.surfaceSource')} /> : null}
        </div>
      </section>

      <section data-scene="2" className="scene s2" style={{ '--h': `${HEIGHTS[1]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <div className="copy">
            <p className="eyebrow mono reveal">{t('journey.s2.title')}</p>
            <div className="counters">
              {counts ? ([[counts.rows, 'journey.c1', 'NASA JPL Horizons'], [counts.artemis, 'journey.c2', 'NASA Moon Trek'], [counts.psr, 'journey.c3', 'NASA Moon Trek'], [counts.resM, 'journey.c4', 'NASA PDS LRO LOLA']] as const).map(([v, k, src], i) => (
                <div className="counter reveal" key={k} style={{ '--i': i } as React.CSSProperties}>
                  <Ticker value={v} run={counting || staticMode} />
                  <span className="c-cap">{t(k)}</span>
                  <span className="c-src mono">{src}</span>
                </div>
              )) : <Skeleton label={t('journey.loadingData')} />}
            </div>
          </div>
        </div>
      </section>

      <section data-scene="3" className="scene s3" style={{ '--h': `${HEIGHTS[2]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <div className="copy">
            <h2 className="display md reveal">{t('journey.s3.title')}</h2>
            <p className="lede reveal">{t('journey.s3.body')}</p>
          </div>
        </div>
      </section>

      <section data-scene="4" className="scene s4" style={{ '--h': `${HEIGHTS[3]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <p className="eyebrow mono">{t('journey.s4.title')}</p>
          <div className="panels">
            {panels.map(([title, cap, kind, vars]) => (
              <article className="glass panel" key={kind} data-panel>
                <h3>{t(title)}</h3>
                {m ? <SeriesChart m={m} kind={kind} draw={!staticMode} height={150} minEarth={minEarth} /> : <Skeleton label={t('journey.loadingData')} />}
                <p className="cap mono">{t(cap, vars)}</p>
              </article>
            ))}
          </div>
          <p className="closing reveal">{t('journey.s4.closing')}</p>
        </div>
      </section>

      <section data-scene="5" className="scene s5" style={{ '--h': `${HEIGHTS[4]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <div className="copy">
            <h2 className="display md reveal">{t('journey.s5.title')}</h2>
            <p className="lede reveal">{t('journey.s5.body')}</p>
            <p className="cap mono reveal">{t('hud.poleSource')}</p>
          </div>
        </div>
      </section>

      <section data-scene="6" className="scene s6" style={{ '--h': `${HEIGHTS[5]}vh` } as React.CSSProperties}>
        <div className="scene-in">
          <div className="handoff" data-reveal-circle style={staticMode ? undefined : { clipPath: 'circle(0% at 50% 50%)' }}>
            <h2 className="display md">{t('journey.s6.title')}</h2>
            <p className="lede">{t('journey.s6.body')}</p>
            <button type="button" className="btn-primary" onClick={onPlanner}><span>{t('journey.s6.cta')}</span><Icon name="arrow" size={18} className="flip-rtl" /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Digits roll up once (ticker) with a faint echo line below (04 §5, scene 2). Values come from the data files. */
function Ticker({ value, run }: { value: number; run: boolean }) {
  const s = fmtNum(value);
  return (
    <span className="ticker" aria-label={s} dir="ltr">
      <span className="tk-row" aria-hidden="true">
        {[...s].map((ch, i) => /\d/.test(ch)
          ? <span className="tk-col" key={i}><span className="tk-strip" style={{ transform: `translateY(${run ? -Number(ch) * 10 : 0}%)`, transitionDelay: `${i * 0.12}s` }}>{'0123456789'.split('').map((d) => <span key={d}>{d}</span>)}</span></span>
          : <span key={i}>{ch}</span>)}
      </span>
      <span className="tk-echo" aria-hidden="true">{run ? s : s.replace(/\d/g, '0')}</span>
    </span>
  );
}
