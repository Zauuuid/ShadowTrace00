import type { Reason } from '../planner/mission';

/** Battery colour: green covers the longest darkness with 25 % margin, amber just covers it, red does not, blue = no data. */
export function batteryTone(batteryH: number, darkH: number | null): 'good' | 'warn' | 'bad' | 'nodata' {
  if (darkH === null) return 'nodata';
  if (darkH <= 0) return 'good';
  return batteryH >= 1.25 * darkH ? 'good' : batteryH >= darkH ? 'warn' : 'bad';
}


/** The site on its own (step 3): Sun, Earth and battery only. Slope is judged later, with the error margin (step 4). */
export function siteStatus(reasons: readonly Reason[], insufficient: boolean): { status: 'good' | 'warn' | 'insufficient'; reasons: Reason[] } {
  if (insufficient) return { status: 'insufficient', reasons: [] };
  const r = reasons.filter((x) => x.code !== 'slope');
  return { status: r.length ? 'warn' : 'good', reasons: r };
}
