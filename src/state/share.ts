/**
 * Mission share link: every input of a plan encoded in the URL hash (#m=<base64url JSON>), so a teammate can open
 * the exact same mission. Decoding validates every field and returns null for anything out of range.
 */
import type { Dispersion } from '../planner/landing';
import type { Limits, PanelMode, Spacecraft } from '../planner/mission';
import type { LatLon } from '../planner/polar';

export interface MissionInputs {
  readonly site: LatLon;
  readonly dispersion: Dispersion;
  readonly startMs: number;
  readonly endMs: number;
  readonly craft: Spacecraft;
  readonly limits: Limits;
}

export const MAX_BATTERY_WH = 500_000;
const PANELS: readonly PanelMode[] = ['tracking', 'fixed', 'horizontal'];

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeMission(m: MissionInputs): string {
  return `#m=${b64urlEncode(JSON.stringify(m))}`;
}

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

export function decodeMission(hash: string): MissionInputs | null {
  const m = /^#m=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  let o: Record<string, Record<string, unknown> | unknown>;
  try {
    o = JSON.parse(b64urlDecode(m[1]!)) as typeof o;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const s = o.site as Record<string, unknown> | undefined;
  const d = o.dispersion as Record<string, unknown> | undefined;
  const c = o.craft as Record<string, unknown> | undefined;
  const l = o.limits as Record<string, unknown> | undefined;
  if (!s || !d || !c || !l) return null;
  const lat = num(s.lat, -90, -75), lon = num(s.lon, -180, 180);
  const startMs = num(o.startMs, 0, 1e14), endMs = num(o.endMs, 0, 1e14);
  const disp = [d.northM, d.eastM, d.southM, d.westM].map((v) => num(v, 0, 100_000));
  const craft = {
    arrayAreaM2: num(c.arrayAreaM2, 0, 1000), arrayEff: num(c.arrayEff, 0, 1), batteryWh: num(c.batteryWh, 0, MAX_BATTERY_WH),
    usableFrac: num(c.usableFrac, 0, 1), dayLoadW: num(c.dayLoadW, 0, 100_000), nightLoadW: num(c.nightLoadW, 0, 100_000),
    fixedAzDeg: num(c.fixedAzDeg, 0, 360), mastM: num(c.mastM, 0, 100),
  };
  const limits = {
    minEarthElDeg: num(l.minEarthElDeg, -10, 90), maxBlackoutH: num(l.maxBlackoutH, 0, 100_000),
    minContactHPerDay: num(l.minContactHPerDay, 0, 24), maxSlopeDeg: num(l.maxSlopeDeg, 0, 90), legSpanM: num(l.legSpanM, 0.1, 100),
  };
  const panel = PANELS.find((p) => p === c.panel);
  if (lat === null || lon === null || startMs === null || endMs === null || endMs <= startMs || !panel) return null;
  if (disp.some((v) => v === null) || Object.values(craft).some((v) => v === null) || Object.values(limits).some((v) => v === null)) return null;
  return {
    site: { lat, lon },
    dispersion: { northM: disp[0]!, eastM: disp[1]!, southM: disp[2]!, westM: disp[3]! },
    startMs, endMs,
    craft: { ...(craft as Record<keyof typeof craft, number>), panel } as Spacecraft,
    limits: limits as Record<keyof typeof limits, number> as Limits,
  };
}
