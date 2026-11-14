import { useEffect, useState } from 'react';
import { makeEphemeris, type Ephemeris, type EphemerisFile } from '../planner/ephemeris';
import { PolarTerrain, type GridMeta, type TileMeta } from '../planner/terrain';

const BASE = import.meta.env.BASE_URL;

/** Decompress only if the bytes are still gzip: some servers send .gz with Content-Encoding and the browser already inflated it. */
export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export interface NamedFeature {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly diameterKm: number;
  readonly kind: string;
}
export interface VectorLayers {
  readonly artemis3: { readonly features: readonly { label: string; rings: number[][][] }[] };
  readonly psr: { readonly features: readonly { label: string; point: [number, number]; areaKm2: number; feature: string }[] };
}
export interface SuitMeta {
  readonly extentM: number;
  readonly sizePx: number;
  readonly months: readonly string[];
  readonly rule: string;
}
export interface PlannerData {
  readonly eph: Ephemeris;
  /** Monthly landing-suitability images (public/data/suit/), or null if missing. */
  readonly suit: SuitMeta | null;
  readonly terrain: PolarTerrain;
  readonly names: readonly NamedFeature[];
  readonly vectors: VectorLayers;
}

let cache: Promise<PlannerData> | null = null;

export function loadPlannerData(): Promise<PlannerData> {
  cache ??= (async () => {
    const json = (p: string) => fetch(`${BASE}data/${p}`).then((r) => {
      if (!r.ok) throw new Error(`${p}: ${r.status}`);
      return r.json();
    });
    const terrain = new PolarTerrain({
      regional: async () => {
        const meta = (await json('lola_south_240m.json')) as GridMeta;
        const res = await fetch(`${BASE}data/lola_south_240m.bin.gz`);
        if (!res.ok) throw new Error(`lola_south_240m.bin.gz: ${res.status}`);
        const buf = await gunzip(await res.arrayBuffer());
        if (buf.byteLength !== meta.size * meta.size * 2) throw new Error(`lola_south_240m: ${buf.byteLength} bytes`);
        return { meta, dn: new Int16Array(buf) };
      },
      tileMeta: async () => (await json('dem40/meta.json')) as TileMeta,
      tile: async (r, c) => {
        const res = await fetch(`${BASE}data/dem40/r${r}_c${c}.bin.gz`);
        if (!res.ok) throw new Error(`tile ${r},${c}`);
        const raw = await gunzip(await res.arrayBuffer());
        if (raw.byteLength !== 512 * 512 * 2) throw new Error(`tile ${r},${c}: ${raw.byteLength} bytes`);
        return new Int16Array(raw);
      },
    });
    const [ephFile, namesFile, vectors, , suit] = await Promise.all([
      json('ephemeris.json') as Promise<EphemerisFile>,
      json('lunar_names.json') as Promise<{ features: [string, number, number, number, string][] }>,
      json('moontrek_vectors.json') as Promise<VectorLayers>,
      terrain.init(),
      (json('suit/meta.json') as Promise<SuitMeta>).catch(() => null),
    ]);
    return {
      eph: makeEphemeris(ephFile),
      suit,
      terrain,
      vectors,
      names: namesFile.features.map(([name, lat, lon, diameterKm, kind]) => ({ name, lat, lon, diameterKm, kind })),
    };
  })();
  return cache;
}

export function usePlannerData(): PlannerData | null | Error {
  const [d, setD] = useState<PlannerData | null | Error>(null);
  useEffect(() => {
    let live = true;
    loadPlannerData().then((x) => live && setD(x), (e: unknown) => live && setD(e instanceof Error ? e : new Error(String(e))));
    return () => { live = false; };
  }, []);
  return d;
}
