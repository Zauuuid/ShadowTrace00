import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EphemerisFile } from '../planner/ephemeris';
import { BANNED } from '../state/copy';
import { DICT } from '../state/i18n';
import { bodyDirs, faceRotate, JOURNEY_DATE, KEYS, lonLatToVec3, placeMoon, sampleAt } from './keyframes';

const DATA = 'public/data';

describe('Journey maths', () => {
  it('lon/lat convention: Tycho south, Crisium on the east (right) limb, nothing mirrored', () => {
    const face = (lat: number, lon: number) => faceRotate(lonLatToVec3(lat, lon), 0, 0);
    const tycho = face(-43.3, -11.4);
    expect(tycho[1]).toBeLessThan(-0.6); // south of the disc
    expect(tycho[0]).toBeLessThan(0); // west of centre
    const crisium = face(17, 59);
    expect(crisium[0]).toBeGreaterThan(0.8); // east limb is on the right as seen from Earth
    const c = faceRotate(lonLatToVec3(-6, -8), -6, -8);
    expect(c[2]).toBeCloseTo(1, 9); // the requested point faces the camera
    const pole = faceRotate(lonLatToVec3(-89, 0), -90, 0);
    expect(pole[1]).toBeGreaterThan(0); // at the Handoff lon 0 points up, like the planner map (+y up)
  });

  it('Sun direction at JOURNEY_DATE equals the Horizons row within 1e-6', () => {
    const f = JSON.parse(readFileSync(`${DATA}/ephemeris.json`, 'utf8')) as EphemerisFile;
    const t0 = Date.parse(f.startUtc.endsWith('Z') ? f.startUtc : `${f.startUtc}Z`);
    const i = (Date.parse(JOURNEY_DATE) - t0) / 3_600_000;
    expect(Number.isInteger(i)).toBe(true);
    const want = lonLatToVec3(f.sunLat[i]!, f.sunLon[i]!);
    const got = bodyDirs(f, JOURNEY_DATE).sun;
    for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThan(1e-6);
  });

  it('keyframes: R monotonic between 0.33 and 0.48, no NaN anywhere', () => {
    let prev = -Infinity;
    for (let p = 0.33; p <= 0.48 + 1e-9; p += 0.005) {
      const s = sampleAt(KEYS, p);
      expect(s.R).toBeGreaterThanOrEqual(prev);
      prev = s.R;
    }
    for (let p = 0; p <= 1; p += 0.01) {
      const s = sampleAt(KEYS, p);
      for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
      for (const v of placeMoon(s, 16 / 9)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('texture manifest hashes equal the files', () => {
    const meta = JSON.parse(readFileSync(`${DATA}/moon/moon_meta.json`, 'utf8')) as { files: { name: string; sha256: string }[]; source: { note: string } };
    expect(meta.source.note).toBe('optimized for aesthetics, not science');
    for (const f of meta.files) expect(createHash('sha256').update(readFileSync(`${DATA}/moon/${f.name}`)).digest('hex')).toBe(f.sha256);
  });
});

describe('Copy', () => {
  it('EN and AR have the same keys and no empty strings', () => {
    expect(Object.keys(DICT.ar).sort()).toEqual(Object.keys(DICT.en).sort());
    for (const lang of ['ar', 'en'] as const) for (const v of Object.values(DICT[lang])) expect(v.trim().length).toBeGreaterThan(0);
  });
  it('no banned phrase and no Sun/Earth percentage in any string', () => {
    for (const lang of ['ar', 'en'] as const) {
      for (const [k, v] of Object.entries(DICT[lang])) {
        for (const re of BANNED) expect(re.test(v), `${lang}.${k}: ${v}`).toBe(false);
        expect(/(sun|earth|الشمس|الأرض)[^.]*\{?\w*\}?\s*%/i.test(v) && k !== 'whyBattery', `${lang}.${k}`).toBe(false);
      }
    }
  });
});
