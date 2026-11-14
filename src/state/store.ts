import { create } from 'zustand';
import type { Dispersion } from '../planner/landing';
import type { Limits, Spacecraft } from '../planner/mission';
import type { LatLon } from '../planner/polar';
import { decodeMission } from './share';

import { savedLang, type Lang } from './lang';
export type { Lang };
export type Tz = 'utc' | 'ksa';
export type LayerId = 'suit' | 'grid' | 'psr' | 'earth' | 'detail';
/** 0 welcome · 1 dates · 2 spacecraft · 3 site · 4 error margin · 5 result · 6 report */
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const LAST_STEP = 6;

/** Defaults: averages of published NASA vehicle specs (Nova-C, Blue Ghost, Peregrine, VIPER). Loads are not published. */
export const DEFAULT_CRAFT: Spacecraft = {
  arrayAreaM2: 1.8, arrayEff: 0.196, batteryWh: 2320, usableFrac: 0.85, dayLoadW: 150, nightLoadW: 100,
  panel: 'tracking', fixedAzDeg: 0, mastM: 2,
};
export const DEFAULT_LIMITS: Limits = { minEarthElDeg: 1, maxBlackoutH: 72, minContactHPerDay: 2, maxSlopeDeg: 10, legSpanM: 4 };

export const PRESETS: readonly { id: string; label: string; craft: Partial<Spacecraft> }[] = [
  { id: 'avg', label: 'avg', craft: { arrayAreaM2: 1.8, arrayEff: 0.196, batteryWh: 2320 } },
  { id: 'peregrine', label: 'Peregrine', craft: { arrayAreaM2: 1.8, arrayEff: 0.196, batteryWh: 840 } },
  // Only published values change; unpublished ones keep the average (decision 18).
  { id: 'novac', label: 'Nova-C (IM-1/IM-2)', craft: { batteryWh: 700 } },
  { id: 'viper', label: 'VIPER', craft: { batteryWh: 5420 } },
];

const DAY = 86_400_000;
// A 14-day window in which the default site works for the default lander (Sun, Earth and battery all pass).
const START = Date.parse('2027-01-08T12:00:00Z');
export const DEFAULT_DISPERSION = { northM: 200, eastM: 100, southM: 200, westM: 100 };

interface PlannerState {
  lang: Lang;
  tz: Tz;
  step: Step;
  craftPage: 1 | 2 | 3;
  skipTours: boolean;
  toursSeen: Partial<Record<Step, true>>;
  site: LatLon;
  dispersion: Dispersion;
  startMs: number;
  endMs: number;
  craft: Spacecraft;
  limits: Limits;
  windowDays: number;
  preset: string;
  layers: Record<LayerId, boolean>;
  set: (p: Partial<Omit<PlannerState, 'set'>>) => void;
  setCraft: (p: Partial<Spacecraft>) => void;
  setLimits: (p: Partial<Limits>) => void;
  toggleLayer: (id: LayerId) => void;
}


export const usePlanner = create<PlannerState>((set) => ({
  lang: savedLang(),
  tz: 'utc',
  step: 0,
  craftPage: 1,
  skipTours: false,
  toursSeen: {},
  // Crest of NASA's "Connecting Ridge" Artemis III candidate region: highest 40 m LOLA cell within 3 km
  site: { lat: -89.4391, lon: -137.1912 },
  dispersion: DEFAULT_DISPERSION,
  startMs: START,
  endMs: START + 14 * DAY,
  craft: DEFAULT_CRAFT,
  limits: DEFAULT_LIMITS,
  windowDays: 180,
  preset: 'avg',
  layers: { suit: true, grid: false, psr: false, earth: false, detail: true },
  set: (p) => set(p),
  setCraft: (p) => set((s) => ({ craft: { ...s.craft, ...p } })),
  setLimits: (p) => set((s) => ({ limits: { ...s.limits, ...p } })),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
}));

/** A shared mission link (#m=…) opens straight on the result. */
function applySharedLink(): void {
  if (typeof location === 'undefined') return;
  const m = decodeMission(location.hash);
  if (!m) return;
  usePlanner.setState({ ...m, step: 5, skipTours: true });
  // Drop the hash so later edits are not overwritten by the shared mission on reload.
  history.replaceState(null, '', location.pathname + location.search);
}
applySharedLink();
