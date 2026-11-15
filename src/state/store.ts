import { create } from 'zustand';
import { DEFAULT_REQ, type Requirements } from '../planner/assess';
import type { Dispersion } from '../planner/landing';
import { engineInputs, fleetSpec, type CraftId } from '../planner/fleet';
import type { Limits, Spacecraft } from '../planner/mission';
import type { LatLon } from '../planner/polar';
import { decodeMission } from './share';

import { savedLang, type Lang } from './lang';
export type { Lang };
export type Tz = 'utc' | 'ksa';
export type Mode = 'basic' | 'expert';
export type Page = 'home' | 'fleet' | 'mission' | 'launch' | 'landing' | 'decision' | 'alternatives' | 'data' | 'report';
export const PAGES: readonly Page[] = ['home', 'fleet', 'mission', 'launch', 'landing', 'decision', 'alternatives', 'data', 'report'];
/** The mission journey, in order (Data and Report sit outside it). */
export const JOURNEY: readonly Page[] = ['home', 'fleet', 'mission', 'launch', 'landing', 'decision', 'alternatives'];
export type LayerId = 'suit' | 'grid' | 'psr' | 'earth' | 'detail';
/** Plan stages: 1 dates · 2 spacecraft · 3 location · 4 landing uncertainty · 5 mission requirements */
export type Step = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP = 5;

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
  req: Requirements;
  craftId: CraftId | 'custom';
  missionName: string;
  mode: Mode;
  page: Page;
  windowDays: number;
  preset: string;
  layers: Record<LayerId, boolean>;
  set: (p: Partial<Omit<PlannerState, 'set'>>) => void;
  setCraft: (p: Partial<Spacecraft>) => void;
  setLimits: (p: Partial<Limits>) => void;
  setReq: (p: Partial<Requirements>) => void;
  chooseCraft: (id: CraftId) => void;
  toggleLayer: (id: LayerId) => void;
}

function savedMode(): Mode {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('st.mode') === 'expert' ? 'expert' : 'basic'; } catch { return 'basic'; }
}
export function saveMode(m: Mode): void {
  try { localStorage.setItem('st.mode', m); } catch { /* storage unavailable: keep in memory only */ }
}

export const usePlanner = create<PlannerState>((set) => ({
  lang: savedLang(),
  tz: 'utc',
  step: 1,
  craftPage: 1,
  skipTours: false,
  toursSeen: {},
  // Crest of NASA's "Connecting Ridge" Artemis III candidate region: highest 40 m LOLA cell within 3 km
  site: { lat: -89.4391, lon: -137.1912 },
  dispersion: engineInputs(fleetSpec('explorer')).dispersion,
  startMs: START,
  endMs: START + 14 * DAY,
  craft: engineInputs(fleetSpec('explorer')).craft,
  limits: { ...DEFAULT_LIMITS, ...engineInputs(fleetSpec('explorer')).limits },
  req: DEFAULT_REQ,
  craftId: 'explorer',
  missionName: '',
  mode: savedMode(),
  page: 'home',
  windowDays: 180,
  preset: 'avg',
  layers: { suit: true, grid: false, psr: false, earth: false, detail: true },
  set: (p) => set(p),
  setCraft: (p) => set((s) => ({ craft: { ...s.craft, ...p }, craftId: 'custom' })),
  setLimits: (p) => set((s) => ({ limits: { ...s.limits, ...p } })),
  setReq: (p) => set((s) => ({ req: { ...s.req, ...p } })),
  chooseCraft: (id) => set((s) => { const e = engineInputs(fleetSpec(id)); return { craftId: id, craft: e.craft, limits: { ...s.limits, ...e.limits }, dispersion: e.dispersion }; }),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
}));

/** A shared mission link (#m=…) opens straight on the result. */
function applySharedLink(): void {
  if (typeof location === 'undefined') return;
  const m = decodeMission(location.hash);
  if (!m) return;
  usePlanner.setState({ ...m, page: 'decision', craftId: 'custom', skipTours: true });
  // Drop the hash so later edits are not overwritten by the shared mission on reload.
  history.replaceState(null, '', location.pathname + location.search);
}
applySharedLink();
