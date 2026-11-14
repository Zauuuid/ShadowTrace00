import { hours, type Reason } from '../planner/mission';
import { fmtHours, fmtNum } from './format';
import type { useT } from './i18n';
import type { Analysis } from '../hooks/useAnalysis';

type T = ReturnType<typeof useT>;

export function reasonSentence(t: T, r: Reason): string {
  return r.code === 'battery' ? t('rBattery', { d: fmtHours(r.darkH), b: fmtHours(r.batteryH) })
    : r.code === 'blackout' ? t('rBlackout', { n: r.count, h: fmtHours(r.blackoutH), m: fmtHours(r.maxH) })
      : t('rSlope', { s: fmtNum(r.slopeDeg, 1), m: fmtNum(r.maxDeg) });
}

/** Every sentence explaining the verdict (one per failed rule, or the "all good" sentence). */
export function verdictSentences(t: T, a: Analysis): string[] {
  if ('kind' in a.mission) {
    const c = a.mission.code;
    return [t(c === 'no-ephemeris' ? 'noEph' : c === 'no-terrain' ? 'noTerrain' : 'badDates')];
  }
  if (a.reasons.length) return a.reasons.map((r) => reasonSentence(t, r));
  return [t('okSentence', { b: fmtHours(a.mission.batteryHours), d: fmtHours(hours(a.mission.longestDark)) })];
}
