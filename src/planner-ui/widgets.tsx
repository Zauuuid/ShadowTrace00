/** Small shared UI pieces (chapter 06 §5): line icons, badges, number field, outage list, sheet, mini Moon mark. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Run } from '../planner/mission';
import { fmtDateTime, fmtHours, fmtNum } from '../state/format';
import { useT } from '../state/i18n';
import { clamp, parseNumber } from '../state/number';
import { outageRows } from '../state/outages';
import { usePlanner } from '../state/store';

const PATHS: Record<string, string> = {
  calendar: 'M4 7h16v13H4zM4 11h16M8 4v5M16 4v5',
  lander: 'M8 9h8l2 3v4l-2 2H8l-2-2v-4zM7 18l-3 3M17 18l3 3M12 9V5M8 5h8',
  pin: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
  drift: 'M12 5c5 0 8 3.1 8 7s-3 7-8 7s-8-3.1-8-7s3-7 8-7zM12 11v2M11 12h2',
  chart: 'M4 4v16h16M7 15l4-5l3 3l5-6',
  report: 'M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4',
  battery: 'M4 8h14v8H4zM18 11h2v2h-2M7 11v2',
  panel: 'M3 7h18l-2 9H5zM9 7l-1 9M15 7l1 9M4 11.5h16M12 16v4',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  earth: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16',
  shadow: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 4a8 8 0 0 1 0 16z',
  download: 'M12 4v11M7 10l5 5l5-5M5 20h14',
  link: 'M10 14l4-4M8 12l-2 2a3 3 0 0 0 4 4l2-2M16 12l2-2a3 3 0 0 0-4-4l-2 2',
  info: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 11v5M12 8v.5',
  close: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6l-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  cross: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M9 9l6 6M15 9l-6 6',
  question: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5M12 16.5v.5',
  minus: 'M6 12h12', plus: 'M6 12h12M12 6v12', target: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  print: 'M7 9V4h10v5M6 9h12v7H6zM8 14h8v6H8z',
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function MiniMoon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mini-moon">
      <circle cx="16" cy="16" r="11" fill="#CFC8BC" />
      <path d="M16 5a11 11 0 0 1 0 22a7 11 0 0 0 0-22z" fill="#0A0F18" opacity=".86" />
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="#9FD8E8" strokeWidth=".75" strokeDasharray="2 2.4" />
    </svg>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'nodata';
const TONE_ICON: Record<Tone, IconName> = { ok: 'check', warn: 'warn', bad: 'cross', nodata: 'question' };
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}><Icon name={TONE_ICON[tone]} size={16} />{children}</span>;
}

export function NumberField({ label, unit, value, min, max, step, digits = 0, note, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; step: number; digits?: number; note?: string; onChange: (v: number) => void;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [hit, setHit] = useState(false);
  const commit = (raw: number) => {
    const c = clamp(Math.round(raw * 10 ** digits) / 10 ** digits, min, max);
    setHit(c.clamped && raw > max);
    onChange(c.value);
  };
  return (
    <div className="nf">
      <span className="nf-label">{label}{note ? <em className="nf-note"> · {note}</em> : null}</span>
      <div className="nf-row">
        <button type="button" className="icon-btn sm" aria-label={`− ${label}`} onClick={() => { setText(null); commit(value - step); }}><Icon name="minus" size={16} /></button>
        <label className="nf-val">
          <input inputMode="decimal" dir="ltr" aria-label={label} value={text ?? fmtNum(value, digits)}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { const v = text === null ? null : parseNumber(text); if (v !== null) commit(v); setText(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <em>{unit}</em>
        </label>
        <button type="button" className="icon-btn sm" aria-label={`+ ${label}`} onClick={() => { setText(null); commit(value + step); }}><Icon name="plus" size={16} /></button>
      </div>
      {hit ? <span className="nf-max">{t('maxIs', { v: `${fmtNum(max)} ${unit}` })}</span> : null}
    </div>
  );
}

const HOUR = 3_600_000;
export function OutageList({ runs, kind, max = 6 }: { runs: readonly Run[]; kind: 'sun' | 'earth'; max?: number }) {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const tz = usePlanner((s) => s.tz);
  const { rows, more } = outageRows(runs, max);
  return (
    <div className={`outages ${kind}`}>
      <h4><Icon name={kind === 'sun' ? 'shadow' : 'earth'} size={18} />{t(kind === 'sun' ? 'sunOut' : 'earthOut')}</h4>
      {rows.length === 0 ? <p className="muted small">{t('noOutage')}</p> : (
        <ul className="ledger-list">
          {rows.map((r) => (
            <li key={r.startMs}>
              <bdi>{fmtDateTime(r.startMs, lang, tz)}</bdi>
              <span className="arrow" aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span>
              <bdi>{fmtDateTime(r.endMs, lang, tz)}</bdi>
              <b><bdi>{fmtHours((r.endMs - r.startMs) / HOUR)}</bdi> {t('hShort')}</b>
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? <p className="muted small">{t('moreN', { n: more })}</p> : null}
    </div>
  );
}

/** Bottom sheet on phones, side panel on desktop. Esc closes; focus moves in and is kept inside. */
export function Sheet({ title, onClose, children, side }: { title: ReactNode; onClose: () => void; children: ReactNode; side?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && box.current) {
        const f = box.current.querySelectorAll<HTMLElement>('button, a, input, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className={side ? 'sheet side' : 'sheet'} role="dialog" aria-modal="true" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('close')} onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Skeleton line with a real label (never a spinner alone, never a fake curve). */
export function Skeleton({ label }: { label: string }) {
  return <div className="skeleton" role="status" aria-live="polite"><span className="sk-line" /><span className="mono small">{label}</span></div>;
}
