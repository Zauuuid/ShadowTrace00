/** Screen 01 — the opening. A real NASA-textured Moon, the selected spacecraft, one sentence, one main action. */
import type { PlannerData } from '../data/data';
import { Globe } from '../globe/Globe';
import { useT } from '../state/i18n';
import { usePlanner } from '../state/store';
import { Icon } from '../planner-ui/widgets';
import { CraftImage } from './common';

export function Home({ data }: { data: PlannerData | null }) {
  const t = useT();
  const set = usePlanner((s) => s.set);
  const craftId = usePlanner((s) => s.craftId);
  return (
    <main id="main" className="home">
      <div className="home-moon" aria-hidden="true">
        <Globe data={data} view={{ lat: -38, lon: 30, dist: 3.3 }} autoRotate interactive={false} label="" layers={{ relief: true, suit: false, psr: false, artemis: false }} />
      </div>
      <div className="home-craft">
        <CraftImage id={craftId} view="perspective" eager />
        <span className="craft-shadow" aria-hidden="true" />
      </div>
      <div className="home-copy">
        <p className="brandline mono">SHADOWTRACE</p>
        <p className="eyebrow mono">{t('h.kicker')}</p>
        <h1 className="display xl">{t('h.title')}</h1>
        <p className="lead">{t('h.sub')}</p>
        <div className="cta-row">
          <button type="button" className="btn-primary lg" onClick={() => set({ page: 'fleet' })}><span>{t('h.start')}</span><Icon name="arrow" size={20} className="flip-rtl" /></button>
          <button type="button" className="btn-text" onClick={() => set({ page: 'mission' })}>{t('h.explore')}</button>
        </div>
        <p className="home-steps mono">{t('h.steps')}</p>
      </div>
      <p className="home-credit mono">{t('h.credit')}</p>
    </main>
  );
}
