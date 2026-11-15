/**
 * Screen 02 — choose your spacecraft. One stage, three craft at true relative scale on a common ground line with a
 * person for reference. Choosing a craft calls the store's chooseCraft(), which rewrites the engine inputs
 * (leg span, slope limit, dispersion, solar array, battery, loads) — so every later result really changes.
 */
import { useState } from 'react';
import { FLEET, fleetSpec, type CraftId } from '../planner/fleet';
import { fmtNum } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { usePlanner } from '../state/store';
import { NumberField } from '../planner-ui/widgets';
import { CraftImage, NextBar, Person, ScreenHead, craftOf, type View } from './common';

const MAX_H = 3.6;

export function Fleet() {
  const t = useT();
  const craftId = usePlanner((s) => s.craftId);
  const craft = usePlanner((s) => s.craft);
  const limits = usePlanner((s) => s.limits);
  const d = usePlanner((s) => s.dispersion);
  const mode = usePlanner((s) => s.mode);
  const choose = usePlanner((s) => s.chooseCraft);
  const setCraft = usePlanner((s) => s.setCraft);
  const setLimits = usePlanner((s) => s.setLimits);
  const set = usePlanner((s) => s.set);
  const [view, setView] = useState<View>('perspective');
  const id = craftOf(craftId);
  const spec = fleetSpec(id);
  const solarW = 1361 * craft.arrayAreaM2 * craft.arrayEff;
  const name = (c: CraftId) => t(`f.${c}.name` as Key);
  const row = (label: Key, value: string, src: 'sheet' | 'default') => (
    <div className={`spec s-${src}`}><dt>{t(label)}</dt><dd><bdi>{value}</bdi></dd></div>
  );
  return (
    <main id="main" className="screen fleet">
      <ScreenHead kicker={t('nav.step', { n: 1 })} title={t('f.title')} lead={t('f.lead')} />

      <div className="fleet-stage">
        <div className="fleet-hero">
          <CraftImage id={craftId} view={view} eager className="hero-img" key={`${id}-${view}`} />
          <div className="view-switch" role="group" aria-label={t('f.views')}>
            {(['perspective', 'top'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{t(`f.view.${v}` as Key)}</button>)}
          </div>
        </div>

        <div className="fleet-info">
          <p className="eyebrow mono">{t(`f.${id}.class` as Key)}{craftId === 'custom' ? ` · ${t('f.custom')}` : ''}</p>
          <h2 className="display md">{name(id)}</h2>
          <p className="lead small">{t(`f.${id}.role` as Key)}</p>
          <dl className="specs">
            {row('f.height', `≈ ${fmtNum(spec.heightM, 1)} m`, 'sheet')}
            {row('f.legSpan', `≈ ${fmtNum(limits.legSpanM, 1)} m`, 'sheet')}
            {row('f.mass', `≈ ${fmtNum(spec.massKg)} kg`, 'sheet')}
            {row('f.payload', spec.payloadKg ? t('f.upTo', { v: `${fmtNum(spec.payloadKg)} kg` }) : t('f.notGiven'), 'sheet')}
            {row('f.solar', `≈ ${fmtNum(solarW >= 1000 ? solarW / 1000 : solarW, solarW >= 1000 ? 1 : 0)} ${solarW >= 1000 ? 'kW' : 'W'}`, 'sheet')}
            {row('f.duration', spec.maxDurationDays ? t('f.upTo', { v: `${spec.maxDurationDays} ${t('m.days')}` }) : t('f.notGiven'), 'sheet')}
            {row('f.slope', `${fmtNum(limits.maxSlopeDeg)}°`, 'default')}
            {row('f.battery', `${fmtNum(craft.batteryWh / 1000, 1)} kWh`, 'default')}
            {row('f.nav', `±${fmtNum(d.northM)} / ±${fmtNum(d.eastM)} m`, 'default')}
          </dl>
          <p className="spec-legend small"><i className="lg-sheet" />{t('f.sheet')} <i className="lg-default" />{t('f.default')}</p>
          <p className="illus small">{t('f.illustrative')}</p>
        </div>
      </div>

      <section className="lineup" aria-label={t('f.compare')}>
        <h2 className="label mono">{t('f.compare')}</h2>
        <div className="lineup-row">
          <div className="lu-person"><Person heightPx={(1.8 / MAX_H) * 190} /><span className="mono small">{t('f.person')}</span></div>
          {FLEET.map((f) => {
            const on = f.id === id;
            return (
              <button key={f.id} type="button" className={on ? 'lu on' : 'lu'} aria-pressed={on} onClick={() => choose(f.id)}>
                <span className="lu-img" style={{ height: `${(f.heightM / MAX_H) * 190}px` }}><CraftImage id={f.id} view="perspective" /></span>
                <span className="lu-foot" style={{ width: `${(f.legSpanM / 5.8) * 100}%` }} aria-hidden="true" />
                <b>{name(f.id)}</b>
                <span className="mono small muted">{fmtNum(f.heightM, 1)} m · {fmtNum(f.legSpanM, 1)} m</span>
                <span className="lu-cta small">{on ? t('f.selected') : t('f.choose', { n: name(f.id) })}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="why-size">
        <h2 className="h2">{t('f.why.title')}</h2>
        <ul>
          <li><span className="wi wi-legs" aria-hidden="true" />{t('f.why.legs', { s: fmtNum(limits.legSpanM, 1) })}</li>
          <li><span className="wi wi-slope" aria-hidden="true" />{t('f.why.slope', { d: fmtNum(limits.maxSlopeDeg) })}</li>
          <li><span className="wi wi-power" aria-hidden="true" />{t('f.why.power', { w: fmtNum(solarW), b: fmtNum(craft.batteryWh / 1000, 1) })}</li>
          <li><span className="wi wi-nav" aria-hidden="true" />{t('f.why.nav', { n: fmtNum(Math.max(d.northM, d.eastM, d.southM, d.westM)) })}</li>
        </ul>
      </section>

      {mode === 'expert' ? (
        <details className="expert-box" open>
          <summary className="h3">{t('f.edit')}</summary>
          <div className="grid3">
            <NumberField label={t('f.legSpan')} unit="m" value={limits.legSpanM} step={0.1} min={1} max={30} digits={1} onChange={(v) => setLimits({ legSpanM: v })} />
            <NumberField label={t('f.slope')} unit="°" value={limits.maxSlopeDeg} step={1} min={1} max={30} onChange={(v) => setLimits({ maxSlopeDeg: v })} />
            <NumberField label={t('f.battery')} unit="Wh" value={craft.batteryWh} step={500} min={100} max={500000} onChange={(v) => setCraft({ batteryWh: v })} />
            <NumberField label={t('arrayArea')} unit="m²" value={craft.arrayAreaM2} step={0.1} min={0.1} max={50} digits={2} onChange={(v) => setCraft({ arrayAreaM2: v })} />
            <NumberField label={t('f.eff')} unit="%" value={Math.round(craft.arrayEff * 1000) / 10} step={0.5} min={1} max={45} digits={1} onChange={(v) => setCraft({ arrayEff: v / 100 })} />
            <NumberField label={t('dayLoad')} unit="W" value={craft.dayLoadW} step={10} min={1} max={10000} onChange={(v) => setCraft({ dayLoadW: v })} />
            <NumberField label={t('nightLoad')} unit="W" value={craft.nightLoadW} step={10} min={1} max={10000} onChange={(v) => setCraft({ nightLoadW: v })} />
            <NumberField label={t('f.mast')} unit="m" value={craft.mastM} step={0.5} min={0.5} max={30} digits={1} onChange={(v) => setCraft({ mastM: v })} />
          </div>
          {craftId === 'custom' ? <button type="button" className="btn-ghost" onClick={() => choose(id)}>{t('f.reset', { n: name(id) })}</button> : null}
        </details>
      ) : null}

      <NextBar back="home" next={() => set({ page: 'mission' })} label={t('f.next')} />
    </main>
  );
}
