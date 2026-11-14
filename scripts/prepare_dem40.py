"""
Build the 40 m south-pole terrain tiles from NASA PDS LOLA LDEM_85S_20M (LRO-L-LOLA-4-GDR-V1.0).

Input : data-raw/lola85/ldem_85s_20m.img + .lbl (polar stereographic, centre -90/0, 20 m/px, int16 LE, DN*0.5 m rel. 1737.4 km)
Output: public/data/dem40/meta.json + public/data/dem40/r{row}_c{col}.bin.gz
        (512x512 int16 LE tiles, DN*0.5 m, 2x2 mean of the 20 m grid; same sign convention as lola_south_240m:
         sample increases with +x (east at lon 90E), line increases with -y)
Check : heights must agree with the committed 240 m grid (already verified against Shackleton/Faustini).

Usage: python -I scripts/prepare_dem40.py data-raw/lola85 public/data
"""

import gzip
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

TILE = 512


def label(p: Path) -> dict:
    t = p.read_text(errors="replace")
    g = lambda k: float(re.search(rf"\b{k}\s*=\s*([-\d.]+)", t).group(1))
    return {"lines": int(g("LINES")), "samples": int(g("LINE_SAMPLES")), "scale": g("MAP_SCALE"),
            "loff": g("LINE_PROJECTION_OFFSET"), "soff": g("SAMPLE_PROJECTION_OFFSET"), "k": g("SCALING_FACTOR"),
            "R": g("A_AXIS_RADIUS") * 1000.0}


def main():
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    lb = label(raw / "ldem_85s_20m.lbl")
    img = raw / "ldem_85s_20m.img"
    dem = np.memmap(img, dtype="<i2", mode="r", shape=(lb["lines"], lb["samples"]))
    n2 = lb["lines"] // 2
    d40 = dem[: n2 * 2, : n2 * 2].astype(np.float32).reshape(n2, 2, n2, 2).mean(axis=(1, 3))
    d40 = np.round(d40).astype("<i2")
    soff40 = (lb["soff"] + 0.5) / 2 - 0.5
    loff40 = (lb["loff"] + 0.5) / 2 - 0.5

    # cross-check against the committed 240 m grid
    m240 = json.loads((out / "lola_south_240m.json").read_text())
    g240 = np.fromfile(out / "lola_south_240m.bin", dtype="<i2").reshape(m240["size"], m240["size"])
    diffs = []
    for lat, lon in [(-89.0, 0), (-88.5, 120), (-87.0, -60), (-86.0, 45), (-89.67, 129.78), (-87.1, 77.0), (-85.6, -150)]:
        rho = 2 * lb["R"] * math.tan(math.pi / 4 + math.radians(lat) / 2)
        x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
        s40, l40 = soff40 + x / 40.0, loff40 - y / 40.0
        s2, l2 = m240["originSample"] + m240["signSample"] * x / 240.0, m240["originLine"] + m240["signLine"] * y / 240.0
        h40 = d40[int(round(l40)), int(round(s40))] * lb["k"]
        h240 = g240[int(round(l2)), int(round(s2))] * m240["scalingFactorM"]
        diffs.append(abs(h40 - h240))
    print("40 m vs 240 m height differences (m):", [round(float(d)) for d in diffs])
    if np.median(diffs) > 120:
        raise SystemExit("40 m grid disagrees with the 240 m grid: projection/sign problem")

    tiles_dir = out / "dem40"
    tiles_dir.mkdir(parents=True, exist_ok=True)
    nt = math.ceil(n2 / TILE)
    total = 0
    for r in range(nt):
        for c in range(nt):
            block = np.zeros((TILE, TILE), dtype="<i2")
            part = d40[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE]
            block[: part.shape[0], : part.shape[1]] = part
            data = gzip.compress(block.tobytes(), compresslevel=9, mtime=0)
            (tiles_dir / f"r{r}_c{c}.bin.gz").write_bytes(data)
            total += len(data)
    sha = hashlib.sha256()
    with img.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            sha.update(chunk)
    meta = {"source": "NASA PDS LOLA LDEM_85S_20M (LRO-L-LOLA-4-GDR-V1.0), 2x2 mean to 40 m",
            "sourceSha256": sha.hexdigest(), "size": n2, "tile": TILE, "tilesPerSide": nt, "mapScaleM": 40.0,
            "scalingFactorM": lb["k"], "referenceRadiusM": lb["R"], "originSample": soff40, "originLine": loff40,
            "signSample": 1, "signLine": -1, "minLatDeg": -85, "encoding": "gzip int16 LE, row-major 512x512",
            "checkVs240mMedianM": round(float(np.median(diffs)), 1)}
    (tiles_dir / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"{nt * nt} tiles, {total / 1e6:.1f} MB compressed, grid {n2}x{n2} at 40 m")


if __name__ == "__main__":
    main()
