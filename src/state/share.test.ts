import { describe, expect, it } from 'vitest';
import { decodeMission, encodeMission, type MissionInputs } from './share';

const DEF: MissionInputs = {
  site: { lat: -89.4391, lon: -137.1912 },
  dispersion: { northM: 200, eastM: 100, southM: 200, westM: 100 },
  startMs: Date.parse('2027-01-20T12:00:00Z'),
  endMs: Date.parse('2027-02-03T12:00:00Z'),
  craft: { arrayAreaM2: 1.8, arrayEff: 0.196, batteryWh: 2320, usableFrac: 0.85, dayLoadW: 150, nightLoadW: 100, panel: 'tracking', fixedAzDeg: 0, mastM: 2 },
  limits: { minEarthElDeg: 1, maxBlackoutH: 72, minContactHPerDay: 2, maxSlopeDeg: 10, legSpanM: 4 },
};

describe('mission share link', () => {
  it('round-trips the defaults', () => {
    const h = encodeMission(DEF);
    expect(h.startsWith('#m=')).toBe(true);
    expect(decodeMission(h)).toEqual(DEF);
  });
  it('rejects garbage', () => {
    expect(decodeMission('#m=garbage')).toBeNull();
    expect(decodeMission('')).toBeNull();
  });
  it('rejects a site north of 75°S', () => {
    expect(decodeMission(encodeMission({ ...DEF, site: { lat: -70, lon: 0 } }))).toBeNull();
  });
  it('rejects an end before the start', () => {
    expect(decodeMission(encodeMission({ ...DEF, endMs: DEF.startMs }))).toBeNull();
  });
  it('rejects a battery above 500,000 Wh', () => {
    expect(decodeMission(encodeMission({ ...DEF, craft: { ...DEF.craft, batteryWh: 900000 } }))).toBeNull();
  });
});
