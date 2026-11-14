/** Shell: header, language route (#/en, #/ar), Journey (step 0) → Planner (steps 1–6). */
import { useEffect, useMemo, useState } from 'react';
import { resetPlannerData, usePlannerData, type PlannerData } from './data/data';
import { useAnalysis } from './hooks/useAnalysis';
import { Journey } from './journey/Journey';
import { distanceAz } from './planner/polar';
import { ConfidenceDrawer, ReportStep, ResultStep } from './planner-ui/result';
import { CraftStep, DatesStep, MarginStep, SiteStep } from './planner-ui/steps';
import { Icon, MiniMoon, Skeleton } from './planner-ui/widgets';
import { fmtDate, fmtHours, fmtNum } from './state/format';
import { dirName, useT, type Key } from './state/i18n';
import { saveLang, type Lang } from './state/lang';
import { LAST_STEP, usePlanner, type Step } from './state/store';

const STEPS: readonly Key[] = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];

// The route wins over the saved language on first load (#/en, #/ar).
const initial = /^#\/(en|ar)\b/.exec(typeof location === 'undefined' ? '' : location.hash);
if (initial) usePlanner.setState({ lang: initial[1] as Lang });

function useLangRoute(): void {
  const lang = usePlanner((s) => s.lang);
  const set = usePlanner((s) => s.set);
  useEffect(() => {
    const read = () => {
      const m = /^#\/(en|ar)\b/.exec(location.hash);
      if (m && m[1] !== usePlanner.getState().lang) set({ lang: m[1] as Lang });
    };
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [set]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (!location.hash.startsWith(`#/${lang}`)) history.replaceState(null, '', `${location.pathname}${location.search}#/${lang}`);
  }, [lang]);
}

export function App() {
  useLangRoute();
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const step = usePlanner((s) => s.step);
  const craftPage = usePlanner((s) => s.craftPage);
  const set = usePlanner((s) => s.set);
  const [retry, setRetry] = useState(0);
  const data = usePlannerData(retry);
  const ready = data && !(data instanceof Error) ? data : null;
  const { a, busy } = useAnalysis(ready);
  const [drawer, setDrawer] = useState(false);
  const inPlanner = step > 0;

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step, craftPage]);
  const go = (n: Step) => set({ step: n });
  const next = () => {
    if (step === 2 && craftPage < 3) return set({ craftPage: (craftPage + 1) as 2 | 3 });
    if (step === LAST_STEP) return set({ step: 1, craftPage: 1 });
    go((step + 1) as Step);
  };
  const back = () => {
    if (step === 2 && craftPage > 1) return set({ craftPage: (craftPage - 1) as 1 | 2 });
    if (step === 3) return set({ step: 2, craftPage: 3 });
    go((step - 1) as Step);
  };

  return (
    <div className={inPlanner ? 'app planner' : 'app at-journey'}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); go(1); }}>{t('skip.toPlanner')}</a>
      <header className="top">
        <button type="button" className="brand" onClick={() => go(0)} aria-label={t('backTop')}>
          <MiniMoon /><span dir="ltr">ShadowTrace</span>
        </button>
        <div className="top-ctl">
          {!inPlanner ? <button type="button" className="btn-text hide-sm" onClick={() => go(1)}>{t('skip.toPlanner')}</button> : null}
          <div className="seg" role="group" aria-label="time zone">
            {(['utc', 'ksa'] as const).map((z) => <button key={z} type="button" aria-pressed={tz === z} onClick={() => set({ tz: z })}><span className="long">{t(z)}</span><span className="short" aria-hidden="true">{z === 'utc' ? 'UTC' : '+3'}</span></button>)}
          </div>
          <div className="seg" role="group" aria-label="language">
            {(['en', 'ar'] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} lang={l} onClick={() => { saveLang(l); set({ lang: l }); }}>{l === 'en' ? 'EN' : 'عربي'}</button>)}
          </div>
          <button type="button" className="icon-btn" aria-label={t('sources.button')} title={t('sources.button')} onClick={() => setDrawer(true)}><Icon name="info" /></button>
        </div>
      </header>

      {!inPlanner ? <Journey key={lang} a={a} onPlanner={() => go(1)} /> : (
        <div className="planner-shell">
          <nav className="stepper" aria-label="steps">
            {STEPS.map((k, i) => {
              const n = (i + 1) as Step;
              return (
                <button key={k} type="button" className={n === step ? 'stp on' : n < step ? 'stp done' : 'stp'} aria-current={n === step ? 'step' : undefined} onClick={() => go(n)}>
                  <span className="stp-bar" /><span className="stp-l mono">{n < step ? <Icon name="check" size={12} /> : `0${n}`} {t(k)}</span>
                </button>
              );
            })}
            <span className="stp-mobile mono">{t('stepOf', { n: `0${step}` })} · {t(STEPS[step - 1]!).toUpperCase()}</span>
          </nav>
          {ready ? <MissionBar data={ready} /> : null}
          <main id="main" className="step-anim" key={`${step}-${step === 2 ? craftPage : 0}`}>
            {data instanceof Error ? (
              <div className="error" role="alert"><p>{t('dataError', { e: data.message })}</p><button type="button" className="btn-primary" onClick={() => { resetPlannerData(); setRetry((r) => r + 1); }}><span>{t('retry')}</span></button></div>
            ) : !ready ? <Skeleton label={t('loading')} /> : (
              <>
                {step === 1 ? <DatesStep data={ready} /> : null}
                {step === 2 ? <CraftStep a={a} /> : null}
                {step === 3 ? <SiteStep data={ready} a={a} busy={busy} /> : null}
                {step === 4 ? <MarginStep data={ready} a={a} busy={busy} /> : null}
                {step === 5 ? <ResultStep data={ready} a={a} busy={busy} /> : null}
                {step === 6 ? <ReportStep data={ready} a={a} /> : null}
              </>
            )}
          </main>
          <footer className="nav no-print">
            <button type="button" className="btn-text" onClick={back}><Icon name="arrow" size={18} className="flip" />{step === 1 ? t('backTop') : t('back')}</button>
            <button type="button" className="btn-primary" onClick={next}><span>{step === 4 ? t('showResult') : step === LAST_STEP ? t('restart') : t('next')}</span><Icon name="arrow" size={18} className="flip-rtl" /></button>
          </footer>
          <footer className="foot no-print">
            <p>{t('sources.footer')}</p>
            <p>{t('geometryNote')}.</p>
            <button type="button" className="btn-text" onClick={() => setDrawer(true)}>{t('sources.button')}</button>
          </footer>
        </div>
      )}
      {drawer ? <ConfidenceDrawer onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}

/** Choices so far, as chips that jump back to their step. Never a verdict. */
function MissionBar({ data }: { data: PlannerData }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const step = usePlanner((s) => s.step);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const endMs = usePlanner((s) => s.endMs);
  const craft = usePlanner((s) => s.craft);
  const d = usePlanner((s) => s.dispersion);
  const set = usePlanner((s) => s.set);
  const near = useMemo(() => {
    let best: { name: string; m: number; az: number } | null = null;
    for (const n of data.names) { const x = distanceAz(site, n); if (!best || x.m < best.m) best = { name: n.name, m: x.m, az: x.az }; }
    return best;
  }, [data.names, site]);
  if (step < 2) return null;
  const days = (endMs - startMs) / 86_400_000;
  const battH = (craft.batteryWh * craft.usableFrac) / Math.max(1, craft.nightLoadW);
  const chip = (n: Step, body: React.ReactNode) => <button key={n} type="button" className={step === n ? 'mb on' : 'mb'} onClick={() => set({ step: n })}>{body}</button>;
  const parts = [
    chip(1, <><bdi>{fmtDate(startMs, lang, tz)}</bdi> → <bdi>{fmtDate(endMs, lang, tz)}</bdi> · <bdi>{fmtNum(days, days < 10 ? 1 : 0)}</bdi> {t('days')}</>),
    chip(2, <><bdi>{fmtNum(craft.batteryWh)} Wh</bdi> · {t('coversH', { h: fmtHours(battH) })}</>),
    step >= 3 && near ? chip(3, <><span dir="ltr">{near.name}</span> · <bdi>{near.m < 1000 ? `${fmtNum(near.m)} m` : `${fmtNum(near.m / 1000, 1)} km`}</bdi> {dirName(lang, near.az)}</>) : null,
    step >= 4 ? chip(4, <bdi dir="ltr">N {fmtNum(d.northM)} · E {fmtNum(d.eastM)} · S {fmtNum(d.southM)} · W {fmtNum(d.westM)} m</bdi>) : null,
  ].filter(Boolean);
  return <div className="mission-bar mono" role="navigation" aria-label={t('summary')}>{parts.flatMap((p, i) => (i ? [<span key={`s${i}`} className="sep" aria-hidden="true">·</span>, p] : [p]))}</div>;
}
