/**
 * Mission simulation at one site over [start, end]: Sun and Earth from JPL Horizons, terrain horizon from LOLA,
 * array power from the user's spacecraft, battery state of charge step by step. Pure and deterministic.
 *
 * Power   P = S · A · η · f_disc · g      S = 1361 W/m² · (1 au / d_sun)²
 *         g = cos(el) vertical Sun-tracking | cos(el)·max(0, cos(az − az0)) vertical fixed | max(0, sin el) horizontal
 * Battery usable energy = capacity · usable fraction. Load = day load while any of the Sun's disc is visible,
 *         night load otherwise. State of charge is clamped to [0, usable].
 * Earth   in contact when (elevation − terrain horizon) ≥ the minimum Earth elevation. Geometry only (not RF).
 */
import { azEl, covers, discFractionVisible, sunRadiusDeg, type Ephemeris } from './ephemeris';
import { horizonAt, type Horizon } from './horizon';
import type { LatLon } from './polar';

export const SOLAR_CONSTANT_W_M2 = 1361;
const AU_KM = 149_597_870.7;
const HOUR = 3_600_000;

export type PanelMode = 'tracking' | 'fixed' | 'horizontal';

export interface Spacecraft {
  readonly arrayAreaM2: number;
  readonly arrayEff: number;
  readonly batteryWh: number;
  readonly usableFrac: number;
  readonly dayLoadW: number;
  readonly nightLoadW: number;
  readonly panel: PanelMode;
  readonly fixedAzDeg: number;
  readonly mastM: number;
}

export interface Limits {
  readonly minEarthElDeg: number;
  readonly maxBlackoutH: number;
  readonly minContactHPerDay: number;
  readonly maxSlopeDeg: number;
  readonly legSpanM: number;
}

export type MissionEventKind = 'sunset' | 'sunrise' | 'earthset' | 'earthrise' | 'battery-empty' | 'power-back';
export interface MissionEvent {
  readonly kind: MissionEventKind;
  readonly tMs: number;
}

export interface Run {
  readonly startMs: number;
  readonly endMs: number;
}

export interface MissionResult {
  readonly stepMs: number;
  readonly t: Float64Array;
  readonly sunEl: Float32Array;
  readonly sunAz: Float32Array;
  readonly sunMargin: Float32Array;
  readonly sunFrac: Float32Array;
  readonly earthEl: Float32Array;
  readonly earthAz: Float32Array;
  readonly earthMargin: Float32Array;
  readonly powerW: Float32Array;
  readonly socWh: Float32Array;
  readonly events: readonly MissionEvent[];
  readonly usableWh: number;
  readonly batteryHours: number;
  readonly longestDark: Run | null;
  readonly longestBlackout: Run | null;
  /** Every darkness run, longest first. */
  readonly darkRuns: readonly Run[];
  /** Every Earth-blackout run, longest first. */
  readonly blackoutRuns: readonly Run[];
  readonly sunVisiblePct: number;
  readonly earthVisiblePct: number;
  readonly minSocPct: number;
  readonly minSocAtMs: number;
  readonly emptyHours: number;
  readonly firstEmptyMs: number | null;
  readonly minContactHPerDay: number;
  readonly peakPowerW: number;
}

export type Insufficient = { readonly kind: 'insufficient'; readonly code: 'no-ephemeris' | 'no-terrain' | 'bad-dates' };

/** All runs of consecutive flagged steps, longest first (stable for equal lengths: earlier first). */
function allRuns(flags: Uint8Array, t: Float64Array, stepMs: number): Run[] {
  const out: Run[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === 1;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ startMs: t[start]!, endMs: t[i - 1]! + stepMs });
      start = -1;
    }
  }
  return out.sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs) || a.startMs - b.startMs);
}

function crossing(t0: number, t1: number, v0: number, v1: number, level: number): number {
  if (v1 === v0) return t1;
  return t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
}

/**
 * Simulation step for a mission length: 10 minutes up to 60 days, then coarser (multiples of 5 min, at most 60)
 * so a multi-year mission stays near 26,000 steps and the page stays responsive.
 */
export function stepMinutesFor(durationMs: number): number {
  const minutes = durationMs / 60_000;
  if (minutes <= 60 * 24 * 60) return 10;
  return Math.max(10, Math.min(60, Math.ceil(minutes / 26_280 / 5) * 5));
}

export function simulate(
  eph: Ephemeris,
  hz: Horizon,
  site: LatLon,
  startMs: number,
  endMs: number,
  sc: Spacecraft,
  lim: Limits,
  stepMin = 10,
): MissionResult | Insufficient {
  if (!(endMs > startMs)) return { kind: 'insufficient', code: 'bad-dates' };
  if (!covers(eph, startMs) || !covers(eph, endMs)) return { kind: 'insufficient', code: 'no-ephemeris' };
  if (!Number.isFinite(hz.groundM)) return { kind: 'insufficient', code: 'no-terrain' };
  const stepMs = stepMin * 60_000;
  const n = Math.floor((endMs - startMs) / stepMs) + 1;
  const t = new Float64Array(n);
  const sunEl = new Float32Array(n), sunAz = new Float32Array(n), sunMargin = new Float32Array(n), sunFrac = new Float32Array(n);
  const earthEl = new Float32Array(n), earthAz = new Float32Array(n), earthMargin = new Float32Array(n);
  const powerW = new Float32Array(n), socWh = new Float32Array(n);
  const dark = new Uint8Array(n), blackout = new Uint8Array(n);
  const usableWh = sc.batteryWh * sc.usableFrac;
  let soc = usableWh;
  let peak = 0, sunOn = 0, earthOn = 0, minSoc = soc, minSocAt = startMs, emptySteps = 0;
  let firstEmpty: number | null = null;
  const events: MissionEvent[] = [];
  const D = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const ti = startMs + i * stepMs;
    t[i] = ti;
    const s = azEl(eph, 'sun', site, hz.observerM, ti);
    const e = azEl(eph, 'earth', site, hz.observerM, ti);
    const sm = s.el - horizonAt(hz, s.az);
    const frac = discFractionVisible(sm, sunRadiusDeg(s.km));
    const em = e.el - horizonAt(hz, e.az);
    const S = SOLAR_CONSTANT_W_M2 * (AU_KM / s.km) ** 2;
    const g = sc.panel === 'horizontal' ? Math.max(0, Math.sin(s.el * D))
      : sc.panel === 'fixed' ? Math.cos(s.el * D) * Math.max(0, Math.cos((s.az - sc.fixedAzDeg) * D))
      : Math.cos(s.el * D);
    const p = S * sc.arrayAreaM2 * sc.arrayEff * frac * g;
    const load = frac > 0 ? sc.dayLoadW : sc.nightLoadW;
    if (i > 0) {
      const prev = soc;
      const raw = soc + ((p + powerW[i - 1]!) / 2 - load) * (stepMs / HOUR);
      soc = Math.max(0, Math.min(usableWh, raw));
      if (prev > 0 && soc === 0) {
        const tEmpty = ti - stepMs + (prev / (prev - raw)) * stepMs;
        events.push({ kind: 'battery-empty', tMs: tEmpty });
        firstEmpty ??= tEmpty;
      }
      if (prev === 0 && soc > 0) events.push({ kind: 'power-back', tMs: ti });
      const fPrev = sunFrac[i - 1]!;
      if (fPrev > 0 && frac === 0) events.push({ kind: 'sunset', tMs: crossing(t[i - 1]!, ti, sunMargin[i - 1]!, sm, -sunRadiusDeg(s.km)) });
      if (fPrev === 0 && frac > 0) events.push({ kind: 'sunrise', tMs: crossing(t[i - 1]!, ti, sunMargin[i - 1]!, sm, -sunRadiusDeg(s.km)) });
      const ePrev = earthMargin[i - 1]! >= lim.minEarthElDeg;
      const eNow = em >= lim.minEarthElDeg;
      if (ePrev && !eNow) events.push({ kind: 'earthset', tMs: crossing(t[i - 1]!, ti, earthMargin[i - 1]!, em, lim.minEarthElDeg) });
      if (!ePrev && eNow) events.push({ kind: 'earthrise', tMs: crossing(t[i - 1]!, ti, earthMargin[i - 1]!, em, lim.minEarthElDeg) });
    }
    sunEl[i] = s.el; sunAz[i] = s.az; sunMargin[i] = sm; sunFrac[i] = frac;
    earthEl[i] = e.el; earthAz[i] = e.az; earthMargin[i] = em;
    powerW[i] = p; socWh[i] = soc;
    dark[i] = frac === 0 ? 1 : 0;
    blackout[i] = em < lim.minEarthElDeg ? 1 : 0;
    if (frac > 0) sunOn++;
    if (!blackout[i]) earthOn++;
    if (soc === 0) emptySteps++;
    if (p > peak) peak = p;
    if (soc < minSoc) { minSoc = soc; minSocAt = ti; }
  }
  const perDay = Math.round(86_400_000 / stepMs);
  let minContact = Infinity;
  for (let d = 0; d + perDay <= n; d += perDay) {
    let c = 0;
    for (let k = d; k < d + perDay; k++) if (!blackout[k]) c++;
    minContact = Math.min(minContact, (c * stepMs) / HOUR);
  }
  if (!Number.isFinite(minContact)) {
    let c = 0;
    for (let k = 0; k < n; k++) if (!blackout[k]) c++;
    minContact = (c * stepMs) / HOUR;
  }
  events.sort((a, b) => a.tMs - b.tMs);
  const darkRuns = allRuns(dark, t, stepMs), blackoutRuns = allRuns(blackout, t, stepMs);
  return {
    stepMs, t, sunEl, sunAz, sunMargin, sunFrac, earthEl, earthAz, earthMargin, powerW, socWh, events, usableWh,
    batteryHours: sc.nightLoadW > 0 ? usableWh / sc.nightLoadW : Infinity,
    longestDark: darkRuns[0] ?? null, longestBlackout: blackoutRuns[0] ?? null, darkRuns, blackoutRuns,
    sunVisiblePct: (100 * sunOn) / n, earthVisiblePct: (100 * earthOn) / n,
    minSocPct: usableWh > 0 ? (100 * minSoc) / usableWh : 0, minSocAtMs: minSocAt,
    emptyHours: (emptySteps * stepMs) / HOUR, firstEmptyMs: firstEmpty, minContactHPerDay: minContact, peakPowerW: peak,
  };
}

export function hours(r: Run | null): number {
  return r ? (r.endMs - r.startMs) / HOUR : 0;
}

export type Reason =
  | { readonly code: 'battery'; readonly darkH: number; readonly batteryH: number; readonly emptyAtMs: number }
  | { readonly code: 'blackout'; readonly blackoutH: number; readonly maxH: number; readonly count: number }
  | { readonly code: 'slope'; readonly slopeDeg: number; readonly maxDeg: number };

/**
 * Hard-constraint checks, in the order a planner would read them: battery, then Earth blackout.
 * (A "minimum contact hours per day" rule existed in v1; it was dropped because contact is reported as outage periods.)
 */
export function powerCommsReasons(r: MissionResult, lim: Limits): Reason[] {
  const out: Reason[] = [];
  if (r.firstEmptyMs !== null) out.push({ code: 'battery', darkH: hours(r.longestDark), batteryH: r.batteryHours, emptyAtMs: r.firstEmptyMs });
  if (hours(r.longestBlackout) > lim.maxBlackoutH) {
    out.push({ code: 'blackout', blackoutH: hours(r.longestBlackout), maxH: lim.maxBlackoutH, count: r.blackoutRuns.length });
  }
  return out;
}

const MAJOR_DARK_H = 24;
const MAJOR_BLACKOUT_H = 48;

/**
 * The events worth reading: the start and end of every darkness of at least 24 h and every Earth blackout of at least
 * 48 h (the longest first, at most `max` events), plus battery-empty / power-back. Returned in time order.
 */
export function majorEvents(r: MissionResult, max = 10): MissionEvent[] {
  const near = (kind: MissionEventKind, tMs: number): MissionEvent => {
    let best: MissionEvent | null = null;
    for (const e of r.events) if (e.kind === kind && (!best || Math.abs(e.tMs - tMs) < Math.abs(best.tMs - tMs))) best = e;
    return best && Math.abs(best.tMs - tMs) <= 2 * r.stepMs ? best : { kind, tMs };
  };
  const out: MissionEvent[] = r.events.filter((e) => e.kind === 'battery-empty' || e.kind === 'power-back').slice(0, 4);
  const pairs: { len: number; ev: MissionEvent[] }[] = [];
  const t0 = r.t[0]!, t1 = r.t[r.t.length - 1]! + r.stepMs;
  for (const run of r.darkRuns) {
    if (run.endMs - run.startMs < MAJOR_DARK_H * HOUR) break;
    const ev: MissionEvent[] = [];
    if (run.startMs > t0) ev.push(near('sunset', run.startMs));
    if (run.endMs < t1) ev.push(near('sunrise', run.endMs));
    pairs.push({ len: run.endMs - run.startMs, ev });
  }
  for (const run of r.blackoutRuns) {
    if (run.endMs - run.startMs < MAJOR_BLACKOUT_H * HOUR) break;
    const ev: MissionEvent[] = [];
    if (run.startMs > t0) ev.push(near('earthset', run.startMs));
    if (run.endMs < t1) ev.push(near('earthrise', run.endMs));
    pairs.push({ len: run.endMs - run.startMs, ev });
  }
  pairs.sort((a, b) => b.len - a.len);
  for (const p of pairs) {
    if (out.length + p.ev.length > max) break;
    out.push(...p.ev);
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}
