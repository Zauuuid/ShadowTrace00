import type { Run } from '../planner/mission';

/** The `max` longest outages (runs arrive longest first), shown in time order, plus how many were left out. */
export function outageRows(runs: readonly Run[], max: number): { rows: Run[]; more: number } {
  const rows = runs.slice(0, max).sort((a, b) => a.startMs - b.startMs);
  return { rows, more: Math.max(0, runs.length - max) };
}
