import type { Lang, Tz } from './store';

const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const TZ_OFFSET = { utc: 0, ksa: 3 * 3_600_000 };

function parts(ms: number, tz: Tz) {
  const d = new Date(ms + TZ_OFFSET[tz]);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const p2 = (n: number) => String(n).padStart(2, '0');

export function fmtDate(ms: number, lang: Lang, tz: Tz): string {
  const p = parts(ms, tz);
  return `${p.d} ${MONTHS[lang][p.mo]} ${p.y}`;
}
export function fmtTime(ms: number, tz: Tz): string {
  const p = parts(ms, tz);
  return `${p2(p.h)}:${p2(p.mi)}`;
}
export function fmtDateTime(ms: number, lang: Lang, tz: Tz): string {
  return `${fmtDate(ms, lang, tz)} · ${fmtTime(ms, tz)}`;
}
export function monthName(m: number, lang: Lang): string {
  return MONTHS[lang][m]!;
}
/** Value for <input type="datetime-local"> in the chosen time zone. */
export function toInput(ms: number, tz: Tz): string {
  const p = parts(ms, tz);
  return `${p.y}-${p2(p.mo + 1)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`;
}
export function fromInput(v: string, tz: Tz): number | null {
  const t = Date.parse(`${v}:00Z`);
  return Number.isFinite(t) ? t - TZ_OFFSET[tz] : null;
}
export function fmtHours(h: number): string {
  return h >= 100 ? Math.round(h).toLocaleString('en-US') : h.toFixed(h < 10 ? 1 : 0);
}
export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function fmtCoord(v: number, isLat: boolean, lang: Lang): string {
  const dir = isLat ? (v < 0 ? (lang === 'ar' ? 'جنوب' : 'S') : (lang === 'ar' ? 'شمال' : 'N')) : v < 0 ? (lang === 'ar' ? 'غرب' : 'W') : (lang === 'ar' ? 'شرق' : 'E');
  return `${Math.abs(v).toFixed(3)}° ${dir}`;
}
/** Tick spacing for a time axis of `days` length (about 15 labels at most). */
export function tickPlan(days: number): { unit: 'day' | 'month' | 'year'; every: number } {
  if (days <= 14) return { unit: 'day', every: 1 };
  if (days <= 40) return { unit: 'day', every: 2 };
  if (days <= 120) return { unit: 'day', every: 7 };
  if (days <= 450) return { unit: 'month', every: 1 };
  if (days <= 1500) return { unit: 'month', every: 3 };
  return { unit: 'year', every: 1 };
}

/** Short day label for timeline ticks, e.g. "5 مارس". */
export function fmtDayTick(ms: number, tz: Tz, lang: Lang): string {
  const p = parts(ms, tz);
  return `${p.d} ${MONTHS[lang][p.mo]}`;
}
