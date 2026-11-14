"""
Pole hillshade for the Journey "Descent" scene. VISUALS ONLY (labelled in the UI); no number comes from this image.

Terrain: NASA PDS LRO LOLA 240 m grid (public/data/lola_south_240m.bin.gz, built by prepare_lola240.py).
Light: the Sun direction at the Journey date from NASA JPL Horizons (public/data/ephemeris.json), so the image shows
the low grazing light of that date. Local relief shading only (no cast shadows), plus a small ambient term (artistic)
so dark ground stays readable.

Crop: +-160.2 km around the pole (1335 x 1335 px at 240 m), north-up like Moon Trek (row 0 = +y), resampled to 2048 px.
Output: public/data/moon/pole_hillshade_2k.webp + pole_hillshade.json

Usage: python -I scripts/prepare_pole_hillshade.py public/data 2027-01-08T12:00:00Z
"""

import gzip
import hashlib
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

HALF_PX = 667.5
AMBIENT = 0.035  # artistic floor
GAIN = 2.2      # visual contrast: shade 0.45 -> white


def sun_at(eph: dict, iso: str) -> tuple[float, float]:
    t0 = datetime.fromisoformat(eph["startUtc"].replace("Z", "+00:00"))
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    f = (t - t0).total_seconds() / 3600.0 / eph["stepHours"]
    i = int(math.floor(f))
    w = f - i
    lat = eph["sunLat"][i] * (1 - w) + eph["sunLat"][i + 1] * w
    lon0, lon1 = eph["sunLon"][i], eph["sunLon"][i + 1]
    d = ((lon1 - lon0 + 540) % 360) - 180
    return lat, ((lon0 + d * w + 540) % 360) - 180


def main() -> None:
    data, iso = Path(sys.argv[1]), sys.argv[2]
    meta = json.loads((data / "lola_south_240m.json").read_text())
    n, scale = meta["size"], meta["mapScaleM"]
    dn = np.frombuffer(gzip.decompress((data / "lola_south_240m.bin.gz").read_bytes()), dtype="<i2").reshape(n, n)
    c = meta["originLine"]
    start = int(round(c - HALF_PX))
    size = int(2 * HALF_PX)
    z = dn[start:start + size, start:start + size].astype(np.float32) * meta["scalingFactorM"]
    # x grows with sample, y shrinks with line
    dzdx = np.gradient(z, axis=1) / scale
    dzdy = -np.gradient(z, axis=0) / scale
    sun_lat, sun_lon = sun_at(json.loads((data / "ephemeris.json").read_text()), iso)
    el, L = math.radians(-sun_lat), math.radians(sun_lon)
    s = np.array([math.cos(el) * math.sin(L), math.cos(el) * math.cos(L), math.sin(el)], dtype=np.float32)
    norm = np.sqrt(dzdx ** 2 + dzdy ** 2 + 1)
    shade = np.clip((-dzdx * s[0] - dzdy * s[1] + s[2]) / norm, 0, None)
    v = np.clip(AMBIENT + shade * GAIN, 0, 1) ** 0.75
    img = Image.fromarray((v * 255 + 0.5).astype(np.uint8), "L").resize((2048, 2048), Image.LANCZOS)
    out = data / "moon"
    out.mkdir(exist_ok=True)
    p = out / "pole_hillshade_2k.webp"
    img.convert("RGB").save(p, "WEBP", quality=82, method=6)
    info = {"date": iso, "sunSubSolarLatDeg": round(sun_lat, 4), "sunSubSolarLonDeg": round(sun_lon, 4),
            "extentM": HALF_PX * scale, "source": "NASA PDS LRO LOLA 240 m + NASA JPL Horizons",
            "note": "visualization only: local relief shading, no cast shadows, ambient and gain are artistic",
            "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    (out / "pole_hillshade.json").write_text(json.dumps(info, indent=1) + "\n")
    print(json.dumps(info))
    print("RESULT: PASS")


if __name__ == "__main__":
    main()
