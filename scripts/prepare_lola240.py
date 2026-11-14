"""
Build the regional south-pole terrain grid from NASA PDS LOLA LDEM_75S_240M (LRO-L-LOLA-4-GDR-V1.0).

Input : <raw>/ldem_75s_240m.img + .lbl (polar stereographic, 3812x3812 int16 LE, DN*0.5 m rel. 1737.4 km)
        from https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/
Output: <out>/lola_south_240m.bin.gz (crop to lat <= -75, int16 LE, gzip -9, mtime 0) + lola_south_240m.json (grid metadata)
Check : the projection sign convention is chosen empirically: Shackleton and Faustini must be depressions.
Note  : *_PROJECTION_OFFSET in these labels is already 0-based (1905.5 = (3812 - 1) / 2). Do not subtract 1.

Usage: python -I scripts/prepare_lola240.py data-raw public/data
"""

import gzip
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

MIN_LAT = -75

R_M = 1737400.0


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def label_value(text: str, key: str) -> str:
    m = re.search(rf"^\s*{key}\s*=\s*([^\n<]+)", text, re.M)
    if not m:
        raise SystemExit(f"label key {key} not found")
    return m.group(1).strip().strip('"')


def main() -> None:
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    lbl = (raw / "ldem_75s_240m.lbl").read_text()
    n = int(label_value(lbl, "LINES"))
    assert n == int(label_value(lbl, "LINE_SAMPLES"))
    scale = float(label_value(lbl, "MAP_SCALE"))
    l0 = float(label_value(lbl, "LINE_PROJECTION_OFFSET"))
    s0 = float(label_value(lbl, "SAMPLE_PROJECTION_OFFSET"))
    k = float(label_value(lbl, "SCALING_FACTOR"))
    assert label_value(lbl, "SAMPLE_TYPE") == "LSB_INTEGER" and label_value(lbl, "SAMPLE_BITS") == "16"
    assert label_value(lbl, "CENTER_LATITUDE").startswith("-90")
    dem = np.fromfile(raw / "ldem_75s_240m.img", dtype="<i2").reshape(n, n)

    def xy(lat, lon):
        rho = 2 * R_M * math.tan(math.pi / 4 + math.radians(lat) / 2)
        return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))

    def at(x, y, sx, sy):
        return dem[int(round(l0 + sy * y / scale)), int(round(s0 + sx * x / scale))] * k

    craters = [(-89.67, 129.78, 10500.0), (-87.18, 84.31, 19500.0)]  # Shackleton, Faustini
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            score = 0.0
            for lat, lon, r in craters:
                x, y = xy(lat, lon)
                ring = [at(x + 1.1 * r * math.cos(math.radians(a)), y + 1.1 * r * math.sin(math.radians(a)), sx, sy) for a in range(0, 360, 30)]
                score += float(np.median(ring)) - at(x, y, sx, sy)
            if best is None or score > best[0]:
                best = (score, sx, sy)
    score, sx, sy = best
    if score < 4000:
        raise SystemExit(f"projection check failed (depth score {score:.0f} m)")

    rho75 = 2 * R_M * math.tan(math.pi / 4 + math.radians(MIN_LAT) / 2)
    c = int(round(l0))
    half = min(int(math.ceil(abs(rho75) / scale)) + 2, c, dem.shape[0] - c)
    crop = dem[c - half: c + half, c - half: c + half].copy()
    (out / "lola_south_240m.bin.gz").write_bytes(gzip.compress(crop.astype("<i2").tobytes(), compresslevel=9, mtime=0))
    meta = {
        "file": "lola_south_240m.bin.gz", "dtype": "int16-le (gzip)", "size": crop.shape[0], "mapScaleM": scale,
        "scalingFactorM": k, "referenceRadiusM": R_M,
        "projection": "polar stereographic (spherical), centre lat -90, centre lon 0, east-positive",
        "originLine": l0 - (c - half), "originSample": s0 - (c - half), "signSample": sx, "signLine": sy, "minLatDeg": MIN_LAT,
        "verification": f"Shackleton + Faustini depth check, score {score:.0f} m",
        "source": {"file": "ldem_75s_240m.img", "sha256": sha256(raw / "ldem_75s_240m.img"), "label": "ldem_75s_240m.lbl",
                   "dataSetId": label_value(lbl, "DATA_SET_ID")},
    }
    (out / "lola_south_240m.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k2: meta[k2] for k2 in ("size", "originLine", "signSample", "signLine", "verification")}))


if __name__ == "__main__":
    main()
