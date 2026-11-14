/**
 * Calendar picker: year → month → day. Picking a day sets 12:00 in the chosen time zone; the time can be changed.
 * Dates outside [min, max] (the loaded JPL Horizons range) are disabled.
 */
import { useEffect, useRef, useState } from 'react';
import { fmtDate, fmtTime, monthName } from '../state/format';
import { useT } from '../state/i18n';
import { usePlanner, type Tz } from '../state/store';

const OFF: Record<Tz, number> = { utc: 0, ksa: 3 * 3_600_000 };
const DAY = 86_400_000;

function local(ms: number, tz: Tz) {
  const d = new Date(ms + OFF[tz]);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
function toMs(y: number, m: number, d: number, h: number, mi: number, tz: Tz) {
  return Date.UTC(y, m, d, h, mi) - OFF[tz];
}

interface Props {
  readonly label: string;
  readonly valueMs: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (ms: number) => void;
  readonly tour?: string;
}

export function DatePicker({ label, valueMs, min, max, onChange, tour }: Props) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const v = local(valueMs, tz);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'year' | 'month' | 'day'>('year');
  const [y, setY] = useState(v.y);
  const [m, setM] = useState(v.m);
  const box = useRef<HTMLDivElement>(null);
  const lo = local(min, tz), hi = local(max, tz);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openPicker = () => { setY(v.y); setM(v.m); setView('year'); setOpen(true); };
  const clampMs = (ms: number) => Math.max(min, Math.min(max, ms));
  const years: number[] = [];
  for (let k = lo.y; k <= hi.y; k++) years.push(k);
  const monthOk = (yy: number, mm: number) => toMs(yy, mm + 1, 1, 0, 0, tz) > min && toMs(yy, mm, 1, 0, 0, tz) <= max;
  const dayOk = (dd: number) => { const s = toMs(y, m, dd, 0, 0, tz); return s + DAY > min && s <= max; };
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const dows = lang === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className={open ? 'dp card open' : 'dp card'} ref={box} data-tour={tour}>
      <span className="dp-label">{t(open ? (view === 'year' ? 'pickYear' : view === 'month' ? 'pickMonth' : 'pickDate') : 'pickDate')}</span>
      <b className="dp-cap">{label}</b>
      <button type="button" className="dp-value" aria-expanded={open} onClick={() => (open ? setOpen(false) : openPicker())}>
        <span>{fmtDate(valueMs, lang, tz)}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <label className="dp-time">
        <span>{t('time')}</span>
        <input type="time" dir="ltr" value={fmtTime(valueMs, tz)}
          onChange={(e) => { const [hh, mm] = e.target.value.split(':').map(Number); if (Number.isFinite(hh) && Number.isFinite(mm)) onChange(clampMs(toMs(v.y, v.m, v.d, hh!, mm!, tz))); }} />
      </label>
      {open ? (
        <div className="dp-pop" role="dialog" aria-label={label}>
          <div className="dp-head">
            {view !== 'year' ? <button type="button" className="dp-crumb" onClick={() => setView('year')}>{y}</button> : <b>{t('pickYear')}</b>}
            {view === 'day' ? <button type="button" className="dp-crumb" onClick={() => setView('month')}>{monthName(m, lang)}</button> : null}
          </div>
          {view === 'year' ? (
            <div className="dp-grid y">
              {years.map((yy) => <button key={yy} type="button" className={yy === v.y ? 'on' : ''} onClick={() => { setY(yy); setView('month'); }}>{yy}</button>)}
            </div>
          ) : view === 'month' ? (
            <div className="dp-grid m">
              {Array.from({ length: 12 }, (_, mm) => (
                <button key={mm} type="button" disabled={!monthOk(y, mm)} className={y === v.y && mm === v.m ? 'on' : ''} onClick={() => { setM(mm); setView('day'); }}>{monthName(mm, lang)}</button>
              ))}
            </div>
          ) : (
            <div className="dp-grid d">
              {dows.map((d, k) => <span key={k} className="dow">{d}</span>)}
              {Array.from({ length: firstDow }, (_, k) => <span key={`e${k}`} />)}
              {Array.from({ length: daysIn }, (_, k) => {
                const dd = k + 1;
                return (
                  <button key={dd} type="button" disabled={!dayOk(dd)} className={y === v.y && m === v.m && dd === v.d ? 'on' : ''}
                    onClick={() => { onChange(clampMs(toMs(y, m, dd, 12, 0, tz))); setOpen(false); }}>{dd}</button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
