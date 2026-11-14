"""
Monthly landing-suitability layer for the south pole (lat <= -75 deg), from NASA data only:
terrain horizon and slope from NASA PDS LOLA (lola_south_240m.bin.gz) and Sun/Earth positions
from NASA JPL Horizons (ephemeris.json, same topocentric formula as src/planner/ephemeris.ts).

For every 2 km cell and every month (Nov 2026 .. Dec 2035), sampled every 2 h:
  sun   = share of the month the Sun's centre is above the terrain horizon
  earth = share of the month the Earth is >= 1 deg above the terrain horizon
  s     = steepest slope to the 8 neighbours on the 240 m grid, degrees
Colour (fixed bands, the same every month, so colours compare across months):
  green  = sun >= 0.45 and earth >= 0.50 and s <= 10 deg  (Sun and Earth up at least about half the month, flat)
  yellow = sun >= 0.30 and earth >= 0.25 and s <= 15 deg
  red    = everything else (long nights, far side with no Earth, or steep)
Why not the spacecraft pass/fail rule: at 2 km resolution no cell keeps its darkness under ~250 h (normal lunar
night), so a battery-based rule paints the whole cap red. The exact verdict for the user's own spacecraft is
computed per site in the app (src/planner/mission.ts); this layer only shows where to look.
Horizon in 36 azimuths (10 deg), ray-marched 0.5..100 km.

Output: <out>/suit/YYYY-MM.png (RGBA, north-up like Moon Trek: row 0 = +y, column 0 = -x) + <out>/suit/meta.json
Self-check: at the default site (Connecting Ridge crest) Jan 2027 must have the Sun up all month (TS reference: 100 %),
slope under 10 deg and Earth up only part of the month (TS reference: 23.6 % for 20 Jan - 3 Feb).
The script exits non-zero otherwise.

Usage: python -I scripts/prepare_suitability.py public/data
"""

import gzip
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

R_M = 1737400.0
D = math.pi / 180
CELL_M = 2000.0
MIN_LAT = -75.0
STEP_H = 2
AZ_N = 36
MAST_M = 2.0
MIN_EARTH_DEG = 1.0
GREEN = (0.45, 0.50, 10.0)
YELLOW = (0.30, 0.25, 15.0)
DEFAULT_SITE = (-89.4391, -137.1912)
COLORS = {0: (94, 224, 160, 150), 1: (255, 181, 71, 150), 2: (255, 122, 122, 140)}


def load_terrain(data: Path):
    meta = json.loads((data / "lola_south_240m.json").read_text())
    n = meta["size"]
    dn = np.frombuffer(gzip.decompress((data / "lola_south_240m.bin.gz").read_bytes()), dtype="<i2").reshape(n, n)
    return meta, dn.astype(np.float32) * meta["scalingFactorM"]


def height(meta, h, x, y):
    """Bilinear height (m) at map coordinates; NaN outside the grid."""
    n = meta["size"]
    s = meta["originSample"] + meta["signSample"] * x / meta["mapScaleM"]
    l = meta["originLine"] + meta["signLine"] * y / meta["mapScaleM"]
    ok = (s >= 0) & (l >= 0) & (s <= n - 1) & (l <= n - 1)
    s = np.clip(s, 0, n - 1.000001)
    l = np.clip(l, 0, n - 1.000001)
    s0 = np.floor(s).astype(np.int64)
    l0 = np.floor(l).astype(np.int64)
    fs = s - s0
    fl = l - l0
    v = (h[l0, s0] * (1 - fs) + h[l0, s0 + 1] * fs) * (1 - fl) + (h[l0 + 1, s0] * (1 - fs) + h[l0 + 1, s0 + 1] * fs) * fl
    return np.where(ok, v, np.nan)


def to_xy(lat, lon):
    rho = 2 * R_M * np.tan(np.pi / 4 + np.radians(lat) / 2)
    return rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))


def to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = np.degrees(2 * np.arctan(rho / (2 * R_M)) - np.pi / 2)
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def axes(x, y):
    rho = np.maximum(np.hypot(x, y), 1e-6)
    nx, ny = x / rho, y / rho  # local north = away from the pole
    return (nx, ny), (ny, -nx)  # east = (cos lon, -sin lon)


def horizons(meta, h, x, y):
    """Terrain horizon elevation (deg) for each point and each of AZ_N azimuths, plus observer height."""
    h0 = height(meta, h, x, y) + MAST_M
    (nx, ny), (ex, ey) = axes(x, y)
    k = 1 + (x * x + y * y) / (4 * R_M * R_M)
    dists = []
    d = 500.0
    while d <= 100_000:
        dists.append(d)
        d += max(240.0, 0.03 * d)
    out = np.full((x.size, AZ_N), -90.0, dtype=np.float32)
    for i in range(AZ_N):
        a = i * (360 / AZ_N) * D
        dx = math.cos(a) * nx + math.sin(a) * ex
        dy = math.cos(a) * ny + math.sin(a) * ey
        best = np.full(x.size, -90.0)
        for d in dists:
            hh = height(meta, h, x + dx * d * k, y + dy * d * k)
            e = np.degrees(np.arctan((hh - d * d / (2 * R_M) - h0) / d))
            best = np.fmax(best, e)
        out[:, i] = best
    return out, h0


def slopes(meta, h, x, y):
    k = 1 + (x * x + y * y) / (4 * R_M * R_M)
    step = meta["mapScaleM"]
    c = height(meta, h, x, y)
    worst = np.zeros(x.size)
    for ox, oy in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
        dist_map = step * math.hypot(ox, oy)
        hh = height(meta, h, x + ox * step, y + oy * step)
        worst = np.fmax(worst, np.degrees(np.arctan(np.abs(hh - c) / (dist_map / k))))
    return worst


class Sky:
    """Topocentric Sun/Earth elevation and azimuth for many sites at once (formula of src/planner/ephemeris.ts)."""

    def __init__(self, x, y, h0):
        lat, lon = to_latlon(x, y)
        la, lo = np.radians(lat), np.radians(lon)
        self.up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
        self.east = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)])
        self.north = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
        self.p = self.up * ((R_M + h0) / 1000.0)

    def azel(self, lat, lon, km):
        b = np.array([math.cos(lat * D) * math.cos(lon * D), math.cos(lat * D) * math.sin(lon * D), math.sin(lat * D)]) * km
        d = b[:, None] - self.p
        u = d / np.linalg.norm(d, axis=0)
        el = np.degrees(np.arcsin(np.clip((u * self.up).sum(0), -1, 1)))
        az = np.degrees(np.arctan2((u * self.east).sum(0), (u * self.north).sum(0))) % 360
        return az, el


def horizon_at(hz, az):
    a = az / (360 / AZ_N)
    i0 = np.floor(a).astype(np.int64) % AZ_N
    f = a - np.floor(a)
    rows = np.arange(hz.shape[0])
    return hz[rows, i0] * (1 - f) + hz[rows, (i0 + 1) % AZ_N] * f


def months():
    out = []
    y, m = 2026, 11
    while (y, m) <= (2035, 12):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def classify(eph, t0_ms, sky, hz, slope, y, m):
    """Return (class array 0 green / 1 yellow / 2 red, Sun share, Earth share) for one month."""
    start = datetime(y, m, 1, tzinfo=timezone.utc).timestamp() * 1000
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    n = hz.shape[0]
    sun = np.zeros(n); earth = np.zeros(n); k = 0
    idx = int((start - t0_ms) // 3_600_000)
    last = min(int((end - t0_ms) // 3_600_000), eph["count"])
    for i in range(idx, last, STEP_H):
        saz, sel = sky.azel(eph["sunLat"][i], eph["sunLon"][i], eph["sunKm"][i])
        sun += sel >= horizon_at(hz, saz)
        eaz, eel = sky.azel(eph["earthLat"][i], eph["earthLon"][i], eph["earthKm"][i])
        earth += (eel - horizon_at(hz, eaz)) >= MIN_EARTH_DEG
        k += 1
    sun /= max(1, k); earth /= max(1, k)
    green = (sun >= GREEN[0]) & (earth >= GREEN[1]) & (slope <= GREEN[2])
    yellow = ~green & (sun >= YELLOW[0]) & (earth >= YELLOW[1]) & (slope <= YELLOW[2])
    return np.where(green, 0, np.where(yellow, 1, 2)), sun, earth


def main() -> None:
    data = Path(sys.argv[1])
    meta, h = load_terrain(data)
    eph = json.loads((data / "ephemeris.json").read_text())
    t0 = datetime.fromisoformat(eph["startUtc"].replace("Z", "+00:00")).timestamp() * 1000

    # self-check at the exact default site
    sx, sy = to_xy(np.array([DEFAULT_SITE[0]]), np.array([DEFAULT_SITE[1]]))
    shz, sh0 = horizons(meta, h, sx, sy)
    ssl = slopes(meta, h, sx, sy)
    cls, su, ea = classify(eph, t0, Sky(sx, sy, sh0), shz, ssl, 2027, 1)
    print(f"self-check Jan 2027 at default site: Sun share {su[0]:.2f}, Earth share {ea[0]:.2f}, slope {ssl[0]:.1f} deg, class {int(cls[0])}")
    if not (su[0] > 0.99 and ssl[0] <= GREEN[2] and 0.2 < ea[0] < 0.8):
        raise SystemExit("self-check failed: expected Sun up all month (TS reference: 100 %), flat ground, Earth part of the month")

    extent = abs(float(to_xy(np.array([MIN_LAT]), np.array([0.0]))[1][0]))
    size = int(math.ceil(2 * extent / CELL_M))
    cell = 2 * extent / size
    cx = -extent + (np.arange(size) + 0.5) * cell
    cy = extent - (np.arange(size) + 0.5) * cell
    gx, gy = np.meshgrid(cx, cy)
    inside = np.hypot(gx, gy) <= extent
    x, y = gx[inside], gy[inside]
    print(f"grid {size}x{size}, {x.size} cells inside 75 S; computing horizons ...", flush=True)
    hz, h0 = horizons(meta, h, x, y)
    sl = slopes(meta, h, x, y)
    valid = np.isfinite(h0) & np.isfinite(sl)
    hz = np.nan_to_num(hz, nan=-90.0)
    sky = Sky(x, y, np.nan_to_num(h0, nan=0.0))

    out = data / "suit"
    out.mkdir(exist_ok=True)
    names = []
    for (yy, mm) in months():
        cls, _, _ = classify(eph, t0, sky, hz, np.nan_to_num(sl, nan=90.0), yy, mm)
        img = np.zeros((size, size, 4), dtype=np.uint8)
        flat = np.zeros((x.size, 4), dtype=np.uint8)
        for c, rgba in COLORS.items():
            flat[(cls == c) & valid] = rgba
        img[inside] = flat
        name = f"{yy:04d}-{mm:02d}"
        Image.fromarray(img, "RGBA").save(out / f"{name}.png", optimize=True)
        names.append(name)
        share = [float(np.mean(cls[valid] == c)) * 100 for c in (0, 1, 2)]
        print(f"{name}: green {share[0]:.1f}%  yellow {share[1]:.1f}%  red {share[2]:.1f}%", flush=True)

    (out / "meta.json").write_text(json.dumps({
        "extentM": round(extent, 3), "sizePx": size, "cellM": round(cell, 3), "months": names,
        "rule": f"share of the month: green = Sun >= {GREEN[0]}, Earth >= {GREEN[1]} (>= {MIN_EARTH_DEG:.0f} deg above terrain), "
                f"slope <= {GREEN[2]:.0f} deg; yellow = Sun >= {YELLOW[0]}, Earth >= {YELLOW[1]}, slope <= {YELLOW[2]:.0f} deg; red = otherwise",
        "source": "NASA PDS LOLA LDEM_75S_240M (horizon, slope) + NASA JPL Horizons (Sun, Earth); sampled every 2 h",
    }, indent=2))
    total = sum(p.stat().st_size for p in out.glob("*.png"))
    print(f"wrote {len(names)} months to {out} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
