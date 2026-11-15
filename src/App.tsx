/**
 * Shell: header (brand, journey progress with the selected spacecraft always visible, settings, menu) and the
 * screens of the mission journey. Routes: #/<lang>/<page> (e.g. #/ar/landing). Shared links #m=… open on the decision.
 */
import { useEffect, useState } from 'react';
import { resetPlannerData, usePlannerData } from './data/data';
import { useAnalysis } from './hooks/useAnalysis';
import { Methods } from './methods/Methods';
import { ConfidenceDrawer, ReportStep } from './planner-ui/result';
import { useCandidates } from './planner-ui/assessment';
import { Icon, Skeleton } from './planner-ui/widgets';
import { Alternatives } from './screens/Alternatives';
import { CraftImage, craftOf } from './screens/common';
import { Decision } from './screens/Decision';
import { Fleet } from './screens/Fleet';
import { Home } from './screens/Home';
import { Landing } from './screens/Landing';
import { Launch } from './screens/Launch';
import { Mission } from './screens/Mission';
import { useT, type Key } from './state/i18n';
import { saveLang, type Lang } from './state/lang';
import { JOURNEY, PAGES, saveMode, usePlanner, type Page } from './state/store';
import type { PlannerData } from './data/data';
import type { Analysis } from './hooks/useAnalysis';

const ROUTE = /^#\/(en|ar)(?:\/([a-z]+))?/;
const initial = ROUTE.exec(typeof location === 'undefined' ? '' : location.hash);
if (initial) {
  const p = initial[2] as Page | undefined;
  usePlanner.setState({ lang: initial[1] as Lang, ...(p && PAGES.includes(p) ? { page: p } : {}) });
}

function useRoute(): void {
  const lang = usePlanner((s) => s.lang);
  const page = usePlanner((s) => s.page);
  const set = usePlanner((s) => s.set);
  useEffect(() => {
    const read = () => {
      const m = ROUTE.exec(location.hash);
      if (!m) return;
      const p = (m[2] && PAGES.includes(m[2] as Page) ? m[2] : 'home') as Page;
      const st = usePlanner.getState();
      if (m[1] !== st.lang || p !== st.page) set({ lang: m[1] as Lang, page: p });
    };
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [set]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const want = `#/${lang}${page === 'home' ? '' : `/${page}`}`;
    if (location.hash !== want) {
      if (location.hash.startsWith('#/')) history.pushState(null, '', `${location.pathname}${location.search}${want}`);
      else history.replaceState(null, '', `${location.pathname}${location.search}${want}`);
    }
    window.scrollTo({ top: 0 });
  }, [lang, page]);
}

const STAGES: readonly Page[] = JOURNEY.slice(1);

export function App() {
  useRoute();
  const t = useT();
  const page = usePlanner((s) => s.page);
  const [retry, setRetry] = useState(0);
  const data = usePlannerData(retry);
  const ready = data && !(data instanceof Error) ? data : null;
  const { a, busy } = useAnalysis(ready);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const immersive = page === 'home' || page === 'launch';

  return (
    <div className={`app page-${page}${immersive ? ' immersive' : ''}`}>
      <a className="skip-link" href="#main">{t('h.start')}</a>
      <Header onMenu={() => setMenu(true)} onSources={() => setDrawer(true)} />
      {data instanceof Error ? (
        <div className="error screen" role="alert"><p>{t('dataError', { e: data.message })}</p><button type="button" className="btn-primary" onClick={() => { resetPlannerData(); setRetry((r) => r + 1); }}><span>{t('retry')}</span></button></div>
      ) : page === 'home' ? <Home data={ready} />
        : page === 'data' ? <Methods />
          : page === 'fleet' ? <Fleet />
            : !ready ? <main id="main" className="screen"><Skeleton label={t('loading')} /></main>
              : page === 'mission' ? <Mission data={ready} />
                : page === 'launch' ? <Launch data={ready} />
                  : page === 'landing' ? <Landing data={ready} a={a} busy={busy} />
                    : page === 'decision' ? <Decision data={ready} a={a} busy={busy} />
                      : page === 'alternatives' ? <Alternatives data={ready} a={a} busy={busy} />
                        : <Report data={ready} a={a} busy={busy} />}
      {!immersive ? (
        <footer className="site-foot">
          <p>{t('sources.footer')}</p>
          <p>{t('geometryNote')}.</p>
          <div><button type="button" className="btn-text" onClick={() => setDrawer(true)}>{t('sources.button')}</button> <button type="button" className="btn-text" onClick={() => usePlanner.getState().set({ page: 'data' })}>{t('nav.data')}</button></div>
        </footer>
      ) : null}
      {ready && (page === 'landing' || page === 'decision') ? <Prefetch data={ready} a={a} busy={busy} /> : null}
      {drawer ? <ConfidenceDrawer onClose={() => setDrawer(false)} /> : null}
      {menu ? <Menu onClose={() => setMenu(false)} /> : null}
    </div>
  );
}

/** Starts the alternatives search as soon as a plan needs it, so the Alternatives screen opens with results. */
function Prefetch({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  useCandidates(data, a, busy, false);
  return null;
}

function Report({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const st = useCandidates(data, a, busy, false);
  return <main id="main" className="screen report-screen"><ReportStep data={data} a={a} alts={st.set5?.items} /></main>;
}

function Settings({ compact }: { compact?: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const mode = usePlanner((s) => s.mode);
  const set = usePlanner((s) => s.set);
  return (
    <>
      <div className="seg mode-seg" role="group" aria-label={t('v4.mode')}>
        {(['basic', 'expert'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => { saveMode(m); set({ mode: m }); }}>{t(`v4.mode.${m}`)}</button>)}
      </div>
      {compact ? null : <div className="seg tz-seg" role="group" aria-label={t('nav.time')}>
        {(['utc', 'ksa'] as const).map((z) => <button key={z} type="button" aria-pressed={tz === z} onClick={() => set({ tz: z })}>{z === 'utc' ? 'UTC' : '+3'}</button>)}
      </div>}
      <div className="seg" role="group" aria-label={t('nav.lang')}>
        {(['ar', 'en'] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} lang={l} onClick={() => { saveLang(l); set({ lang: l }); }}>{l === 'en' ? 'EN' : 'عربي'}</button>)}
      </div>
    </>
  );
}

function Header({ onMenu, onSources }: { onMenu: () => void; onSources: () => void }) {
  const t = useT();
  const page = usePlanner((s) => s.page);
  const craftId = usePlanner((s) => s.craftId);
  const set = usePlanner((s) => s.set);
  const idx = STAGES.indexOf(page);
  const onJourney = idx >= 0;
  return (
    <header className="top">
      <button type="button" className="brand" onClick={() => set({ page: 'home' })} aria-label="SHADOWTRACE">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="#D8DEE8" /><path d="M16 5a11 11 0 0 1 0 22a7 11 0 0 0 0-22z" fill="#142B50" /><circle cx="16" cy="16" r="14" fill="none" stroke="#7868B8" strokeWidth="1.2" strokeDasharray="2 2.6" /></svg>
        <span dir="ltr">SHADOWTRACE</span>
      </button>
      {onJourney ? (
        <nav className="journey" aria-label={t('nav.menu')}>
          <ol>
            {STAGES.map((p, i) => (
              <li key={p} className={i === idx ? 'on' : i < idx ? 'done' : ''}>
                <button type="button" onClick={() => set({ page: p })} aria-current={i === idx ? 'step' : undefined}>
                  <span className="jn mono">{i < idx ? <Icon name="check" size={11} /> : i + 1}</span><span className="jl">{t(`j.${p}` as Key)}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="craft-chip" onClick={() => set({ page: 'fleet' })} title={t('j.fleet')}>
            <CraftImage id={craftId} view="perspective" /><span>{t(`f.${craftOf(craftId)}.name` as Key)}</span>
          </button>
        </nav>
      ) : <span className="top-spacer" />}
      <div className="top-ctl">
        <div className="settings hide-sm"><Settings compact /></div>
        <button type="button" className="icon-btn hide-md" aria-label={t('sources.button')} onClick={onSources}><Icon name="info" /></button>
        <button type="button" className="icon-btn menu-btn" aria-label={t('nav.menu')} onClick={onMenu}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
      </div>
    </header>
  );
}

function Menu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const page = usePlanner((s) => s.page);
  const set = usePlanner((s) => s.set);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const go = (p: Page) => { set({ page: p }); onClose(); };
  return (
    <div className="menu-sheet" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
      <div className="menu-top">
        <span className="brandline mono" dir="ltr">SHADOWTRACE</span>
        <button type="button" className="icon-btn" aria-label={t('nav.close')} onClick={onClose} autoFocus><Icon name="close" /></button>
      </div>
      <ol className="menu-list">
        {JOURNEY.map((p, i) => <li key={p}><button type="button" className={p === page ? 'on' : ''} onClick={() => go(p)}><span className="mono">{String(i).padStart(2, '0')}</span>{t(`j.${p}` as Key)}</button></li>)}
      </ol>
      <ul className="menu-extra">
        <li><button type="button" onClick={() => go('data')}>{t('nav.data')}</button></li>
        <li><button type="button" onClick={() => go('report')}>{t('nav.report')}</button></li>
      </ul>
      <div className="menu-settings"><Settings /></div>
    </div>
  );
}
