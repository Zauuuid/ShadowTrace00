import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzip } from './data';

describe('terrain tile decoding', () => {
  const raw = new Int16Array([1, -2, 300, -4000]);
  const bytes = () => raw.buffer.slice(0);
  it('inflates gzip bytes', async () => {
    const z = gzipSync(new Uint8Array(bytes()));
    const out = await gunzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
    expect(Array.from(new Int16Array(out))).toEqual([1, -2, 300, -4000]);
  });
  it('passes through bytes the server already inflated (Content-Encoding: gzip)', async () => {
    const out = await gunzip(bytes());
    expect(Array.from(new Int16Array(out))).toEqual([1, -2, 300, -4000]);
  });
});
