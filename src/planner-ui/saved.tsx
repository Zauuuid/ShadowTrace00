/** Saved mission assessments (this browser only, localStorage). Each entry stores the share-link hash, so reopening re-runs the engine. */
import { useState } from 'react';
import type { Analysis } from '../hooks/useAnalysis';
import type { Verdict } from '../planner/assess';
import { fmtDate } from '../state/format';
import { useT, type Key } from '../state/i18n';
import { decodeMission } from '../state/share';
import { usePlanner } from '../state/store';
import { Icon } from './widgets';

export interface SavedEntry { readonly id: string; readonly savedAt: number; readonly lat: number; readonly lon: number; readonly startMs: number; readonly verdict: Verdict; readonly score: number; readonly hash: string }
const KEY = 'st.saved.v1';

export function readSaved(): SavedEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as SavedEntry[]).filter((e) => typeof e?.hash === 'string') : [];
  } catch { return []; }
}
function write(list: SavedEntry[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); return true; } catch { return false; }
}

export function SavedAssessments({ a, link }: { a: Analysis | null; link: string }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const site = usePlanner((s) => s.site);
  const startMs = usePlanner((s) => s.startMs);
  const set = usePlanner((s) => s.set);
  const [list, setList] = useState<SavedEntry[]>(() => readSaved());
  const [ok, setOk] = useState(false);
  const hash = link.slice(link.indexOf('#'));
  const save = () => {
    if (!a) return;
    const e: SavedEntry = { id: `${Date.now().toString(36)}`, savedAt: Date.now(), lat: site.lat, lon: site.lon, startMs, verdict: a.assessment.verdict, score: a.assessment.score, hash };
    const next = [e, ...list.filter((x) => x.hash !== hash)];
    if (write(next)) { setList(next); setOk(true); }
  };
  const open = (e: SavedEntry) => {
    const m = decodeMission(e.hash);
    if (m) { set({ ...m, page: 'decision', skipTours: true }); window.scrollTo({ top: 0 }); }
  };
  const del = (id: string) => { const next = list.filter((x) => x.id !== id); if (write(next)) setList(next); };
  return (
    <div className="block saved no-print">
      <div className="saved-head">
        <h2 className="h2">{t('v4.saved')}</h2>
        <button type="button" className="btn-ghost" onClick={save} disabled={!a}><Icon name={ok ? 'check' : 'download'} size={16} />{ok ? t('v4.savedOk') : t('v4.save')}</button>
      </div>
      {list.length === 0 ? <p className="muted">{t('v4.saved.none')}</p> : (
        <ul className="ledger-list saved-list">
          {list.map((e) => (
            <li key={e.id}>
              <span className={`badge ${e.verdict === 'suitable' ? 'ok' : e.verdict === 'conditional' ? 'warn' : e.verdict === 'unsuitable' ? 'bad' : 'nodata'}`}>{t(`v4.verdict.${e.verdict}` as Key)} · {e.score}</span>
              <span className="mono small"><bdi dir="ltr">{e.lat.toFixed(3)}°, {e.lon.toFixed(3)}°</bdi> · <bdi>{fmtDate(e.startMs, lang, tz)}</bdi></span>
              <span className="saved-actions">
                <button type="button" className="btn-text" onClick={() => open(e)}>{t('v4.open')}</button>
                <button type="button" className="btn-text danger" onClick={() => del(e.id)}>{t('v4.delete')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
