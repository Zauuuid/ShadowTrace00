/**
 * Screen 06 — the landing decision. Verdict first; then three clearly different numbers (decision score, modelled
 * touchdown safety, data confidence); then every requirement as Passed / Needs attention / Failed / Could not be
 * assessed. Missing data is never shown as a pass. Expert mode opens the technical details.
 */
import type { PlannerData } from '../data/data';
import type { Analysis } from '../hooks/useAnalysis';
import type { FactorStatus } from '../planner/assess';
import { hours } from '../planner/mission';
import { toXY } from '../planner/polar';
import { fmtDate, fmtHours, fmtNum } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';
import { findingText, pSafeText } from '../planner-ui/assessment';
import { TechnicalDetails } from '../planner-ui/result';
import { Icon, Skeleton } from '../planner-ui/widgets';
import { CraftImage, ScreenHead, craftOf } from './common';

type Status = 'pass' | 'watch' | 'fail' | 'na' | 'info';
const ICON = { pass: 'check', watch: 'warn', fail: 'cross', na: 'question', info: 'info' } as const;
const fromFactor = (s: FactorStatus): Status => (s === 'pass' ? 'pass' : s === 'watch' ? 'watch' : s === 'fail' ? 'fail' : 'na');

export function Decision({ data, a, busy }: { data: PlannerData; a: Analysis | null; busy: boolean }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const name = usePlanner((s) => s.missionName);
  const craftId = usePlanner((s) => s.craftId);
  const limits = usePlanner((s) => s.limits);
  const d = usePlanner((s) => s.dispersion);
  const req = usePlanner((s) => s.req);
  const set = usePlanner((s) => s.set);
  if (!a) return <main id="main" className="screen"><Skeleton label={t('loading')} /></main>;
  const s = a.assessment, td = a.touchdown, m = 'kind' in a.mission ? null : a.mission;
  const tone = s.verdict === 'suitable' ? 'ok' : s.verdict === 'conditional' ? 'warn' : s.verdict === 'unsuitable' ? 'bad' : 'nodata';
  const f = (id: string) => s.factors.find((x) => x.id === id)!;
  const elev = data.terrain.heightAt(toXY(site));
  const worst = a.landing.maxSlopeDeg > limits.maxSlopeDeg;
  const checks: { k: Key; st: Status; text: string }[] = [
    { k: 'c.slope', st: td.valid === 0 ? 'na' : fromFactor(f('terrain').status) === 'fail' ? 'fail' : worst ? 'watch' : 'pass',
      text: td.valid ? `${t('v4.c.footprint')}: ${pSafeText(td)}% · ${lang === 'ar' ? 'المئين 95' : '95th pct'} ${fmtNum(td.slopeP95Deg, 1)}° / ${fmtNum(limits.maxSlopeDeg)}°` : t('fd.td.nodata') },
    { k: 'c.uncertainty', st: fromFactor(f('terrain').status),
      text: t('cx.uncertainty', { n: fmtNum(Math.max(d.northM, d.southM)), e: fmtNum(Math.max(d.eastM, d.westM)), k: fmtNum(req.sigmaLevel, 1) }) },
    { k: 'c.relief', st: 'info', text: t('cx.relief', { h: Number.isFinite(elev) ? fmtNum(elev) : '—', r: fmtNum(td.reliefP95M, 1), g: td.gridM }) },
    { k: 'c.footprint', st: 'na', text: t('cx.footprint', { s: fmtNum(limits.legSpanM, 1), g: td.gridM }) },
    { k: 'c.crater', st: 'info', text: a.context.crater ? t('cx.crater', { name: a.context.crater.name, km: fmtNum(a.context.crater.rimKm, 1) }) : t('cx.craterNone') },
    { k: 'c.illum', st: m ? (m.firstEmptyMs !== null ? 'fail' : 'pass') : 'na', text: m ? t('cx.illum', { p: fmtNum(m.sunVisiblePct), h: fmtHours(hours(m.longestDark)) }) : '—' },
    { k: 'c.power', st: fromFactor(f('power').status), text: s.findings.filter((x) => x.code.startsWith('battery')).map((x) => findingText(t, lang, x))[0] ?? '—' },
    { k: 'c.comms', st: fromFactor(f('comms').status), text: s.findings.filter((x) => x.code.startsWith('blackout') || x.code === 'comms.ok').map((x) => findingText(t, lang, x))[0] ?? '—' },
    { k: 'c.thermal', st: 'na', text: t('fd.thermal.na') },
  ];
  const groups: { st: Status; label: Key }[] = [{ st: 'fail', label: 'd.failed' }, { st: 'watch', label: 'd.watch' }, { st: 'pass', label: 'd.passed' }, { st: 'na', label: 'd.notAssessed' }, { st: 'info', label: 'd.info' }];
  const R = 34, C = 2 * Math.PI * R;
  return (
    <main id="main" className="screen decision">
      <ScreenHead kicker={`${t('nav.step', { n: 5 })} · ${name || t('m.untitled')}`} title={t('d.title')} />
      <section className={`verdict-band ${tone}${busy ? ' busy' : ''}`} aria-live="polite">
        <div className="vb-craft"><CraftImage id={craftOf(craftId)} view="perspective" /></div>
        <div className="vb-main">
          <p className="mono small muted"><bdi dir="ltr">{site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°</bdi> · <bdi>{fmtDate(startMs, lang, tz)}</bdi></p>
          <h2 className="v4-word"><Icon name={s.verdict === 'suitable' ? 'check' : s.verdict === 'conditional' ? 'warn' : s.verdict === 'unsuitable' ? 'cross' : 'question'} size={40} />{t(`v4.verdict.${s.verdict}` as Key)}</h2>
          <p className="v4-lead">{t(`v4.lead.${s.verdict}` as Key)}</p>
          <ul className="v4-top">
            {s.findings.filter((x) => x.tone !== 'info').slice(0, 3).map((x) => <li key={x.code} className={x.tone}><Icon name={x.tone === 'ok' ? 'check' : x.tone === 'warn' ? 'warn' : 'cross'} size={18} /><span>{findingText(t, lang, x)}</span></li>)}
          </ul>
        </div>
        <dl className="three">
          <div className="score">
            <dt>{t('d.score')}</dt>
            <dd><svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true"><circle cx="40" cy="40" r={R} className="ring-bg" /><circle cx="40" cy="40" r={R} className="ring-fg" strokeDasharray={`${(C * s.score) / 100} ${C}`} transform="rotate(-90 40 40)" /></svg><b className="num">{s.score}</b></dd>
            <p className="small muted">{t('d.scoreHelp')}</p>
          </div>
          <div><dt>{t('d.prob')}</dt><dd className="num big">{td.valid ? `${pSafeText(td)}%` : '—'}</dd><p className="small muted">{t('d.probHelp')}</p></div>
          <div><dt>{t('d.conf')}</dt><dd className={`num big conf-${s.confidence}`}>{t(`v4.conf.${s.confidence}` as Key)}</dd><p className="small muted">{t('d.confHelp')} {t('v4.coverage')}: {fmtNum(s.coveragePct, 0)}% · LOLA {td.gridM} m</p></div>
        </dl>
      </section>

      <section className="checks">
        <h2 className="h2">{t('d.checks')}</h2>
        {groups.map((g) => {
          const list = checks.filter((c) => c.st === g.st);
          if (!list.length) return null;
          return (
            <div key={g.st} className={`check-group ${g.st}`}>
              <h3 className="label mono"><Icon name={ICON[g.st]} size={14} />{t(g.label)} · {list.length}</h3>
              <ul>{list.map((c) => <li key={c.k}><b>{t(c.k)}</b><span>{c.text}</span></li>)}</ul>
            </div>
          );
        })}
      </section>

      <div className="decision-actions">
        <button type="button" className="btn-primary lg" onClick={() => set({ page: 'alternatives' })}><span>{s.verdict === 'suitable' ? t('d.compareAnyway') : t('d.seeAlternatives')}</span><Icon name="arrow" size={18} className="flip-rtl" /></button>
        <button type="button" className="btn-ghost" onClick={() => set({ page: 'landing' })}>{t('d.backLanding')}</button>
        <button type="button" className="btn-text" onClick={() => set({ page: 'report' })}>{t('d.report')}</button>
      </div>

      <TechnicalDetails data={data} a={a} busy={busy} />
    </main>
  );
}
