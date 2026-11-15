/**
 * SHADOWTRACE conceptual fleet: Scout, Explorer, Pioneer.
 *
 * These are CONCEPT designs supplied by the team. Height, leg span, mass, payload, solar power and mission duration
 * are the team's illustrative values from the concept sheets ("≈" / "≤" figures); they are not verified engineering or
 * NASA values. Values the sheets do not give (battery, loads, panel efficiency, slope tolerance, navigation
 * uncertainty) are illustrative defaults chosen by SHADOWTRACE so the engine can run, and every one is editable.
 *
 * How a craft drives the science (all through the same engine as any custom spacecraft):
 *   leg span      → footprint drawn at scale; slope baseline max(leg span, 2 × DEM spacing)
 *   slope limit   → touchdown pass/fail in the Monte Carlo model
 *   dispersion    → the uncertainty ellipse and therefore the touchdown distribution
 *   solar power   → array area at the stated cell efficiency → power simulation with JPL Horizons + LOLA horizon
 *   battery/loads → how long the craft survives darkness
 *   mast height   → terrain horizon (taller masts see over more terrain)
 */
import type { Dispersion } from './landing';
import type { Limits, Spacecraft } from './mission';
import { SOLAR_CONSTANT_W_M2 } from './mission';

export type CraftId = 'scout' | 'explorer' | 'pioneer';

export interface FleetSpec {
  readonly id: CraftId;
  /** From the concept sheet (illustrative). null = not given on the sheet. */
  readonly heightM: number;
  readonly legSpanM: number;
  readonly massKg: number;
  readonly payloadKg: number | null;
  readonly solarW: number;
  readonly maxDurationDays: number | null;
  /** SHADOWTRACE illustrative defaults (editable). */
  readonly batteryWh: number;
  readonly dayLoadW: number;
  readonly nightLoadW: number;
  readonly cellEff: number;
  readonly maxSlopeDeg: number;
  readonly mastM: number;
  readonly dispersion: Dispersion;
}

export const FLEET: readonly FleetSpec[] = [
  { id: 'scout', heightM: 2.0, legSpanM: 3.6, massKg: 450, payloadKg: null, solarW: 400, maxDurationDays: null,
    batteryWh: 1500, dayLoadW: 120, nightLoadW: 60, cellEff: 0.3, maxSlopeDeg: 12, mastM: 2.0, dispersion: { northM: 300, eastM: 200, southM: 300, westM: 200 } },
  { id: 'explorer', heightM: 2.8, legSpanM: 4.5, massKg: 1200, payloadKg: 300, solarW: 1800, maxDurationDays: 30,
    batteryWh: 6000, dayLoadW: 450, nightLoadW: 220, cellEff: 0.3, maxSlopeDeg: 10, mastM: 2.8, dispersion: { northM: 200, eastM: 120, southM: 200, westM: 120 } },
  { id: 'pioneer', heightM: 3.6, legSpanM: 5.8, massKg: 2500, payloadKg: 1000, solarW: 2500, maxDurationDays: 180,
    batteryWh: 16000, dayLoadW: 900, nightLoadW: 450, cellEff: 0.3, maxSlopeDeg: 8, mastM: 3.6, dispersion: { northM: 150, eastM: 100, southM: 150, westM: 100 } },
];

export const fleetSpec = (id: CraftId): FleetSpec => FLEET.find((f) => f.id === id)!;

/** Array area that gives the sheet's solar power at normal incidence, 1 AU. */
export function arrayAreaFor(spec: Pick<FleetSpec, 'solarW' | 'cellEff'>): number {
  return spec.solarW / (SOLAR_CONSTANT_W_M2 * spec.cellEff);
}

/** Engine inputs for a fleet craft. */
export function engineInputs(spec: FleetSpec): { craft: Spacecraft; limits: Partial<Limits>; dispersion: Dispersion } {
  return {
    craft: {
      arrayAreaM2: arrayAreaFor(spec), arrayEff: spec.cellEff, batteryWh: spec.batteryWh, usableFrac: 0.85,
      dayLoadW: spec.dayLoadW, nightLoadW: spec.nightLoadW, panel: 'tracking', fixedAzDeg: 0, mastM: spec.mastM,
    },
    limits: { maxSlopeDeg: spec.maxSlopeDeg, legSpanM: spec.legSpanM },
    dispersion: spec.dispersion,
  };
}
