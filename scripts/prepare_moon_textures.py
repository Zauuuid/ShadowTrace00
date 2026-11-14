"""
Build the Journey's Moon textures from the NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720/).

VISUALS ONLY. NASA's own wording for these maps: "optimized for aesthetics, not science".
No number shown by the planner comes from these files (those come from LOLA PDS grids and JPL Horizons).

Inputs (data-raw/svs/):
  lroc_color_poles_8k.tif  8192x4096 RGB colour map (LROC WAC), equirectangular, centred on 0 deg longitude
  ldem_16_uint.tif         5760x2880 uint16 elevation, 16 px/deg, half-metres with +20000 offset:
                           height_m = (DN - 20000) * 0.5
Outputs (public/data/moon/):
  color_2k.webp, color_4k.webp, color_8k.webp (or color_6k.webp when the 8k file would exceed 6 MB)
  normal_2k.webp, normal_4k.webp   tangent-space normals (R = east, G = north, B = up) from a Sobel filter
  moon_meta.json                   file list, sizes, SHA-256, source URLs, NASA wording

Usage: python -I scripts/prepare_moon_textures.py data-raw/svs public/data/moon
"""

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SVS_PAGE = "https://svs.gsfc.nasa.gov/4720/"
SVS_BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
MOON_RADIUS_M = 1737400.0
WEBP_QUALITY = 82
MAX_8K_BYTES = 6 * 1024 * 1024
# Relief exaggeration of the normal map. True slopes at 16 px/deg (1.9 km/px) are a few degrees and would be
# almost invisible on a globe; 3.0 is a visual choice (artistic), documented here and in moon_meta.json.
NORMAL_STRENGTH = 3.0


def px(lat: float, lon: float, w: int, h: int) -> tuple[int, int]:
    """Equirectangular pixel of (lat, east lon), map centred on 0 deg longitude, north at the top."""
    return int((lon + 180.0) / 360.0 * w) % w, min(h - 1, max(0, int((90.0 - lat) / 180.0 * h)))


def disc_mean(grey: np.ndarray, lat: float, lon: float, radius_deg: float) -> float:
    h, w = grey.shape
    x, y = px(lat, lon, w, h)
    r = max(1, int(radius_deg / 180.0 * h))
    return float(grey[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1].mean())


def check_orientation(rgb: np.ndarray) -> dict:
    """Tycho must be a bright rayed crater in the south; Mare Tranquillitatis must be dark. Abort otherwise."""
    grey = rgb[..., :3].astype(np.float32).mean(axis=2)
    overall = float(grey.mean())
    tycho = disc_mean(grey, -43.3, -11.4, 1.2)
    tranq = disc_mean(grey, 8.0, 31.0, 4.0)
    # the mirrored positions must NOT show the same contrast (catches a flipped map)
    tycho_mirror = disc_mean(grey, -43.3, 11.4, 1.2)
    tranq_mirror = disc_mean(grey, 8.0, -31.0, 4.0)
    ok = tycho > overall * 1.15 and tycho > tycho_mirror and tranq < overall * 0.85 and tranq < tranq_mirror
    out = {"overall": round(overall, 1), "tycho": round(tycho, 1), "tranquillitatis": round(tranq, 1),
           "tychoMirror": round(tycho_mirror, 1), "tranquillitatisMirror": round(tranq_mirror, 1)}
    if not ok:
        raise SystemExit(f"ORIENTATION CHECK FAILED: {out}")
    return out


def normal_map(dn: np.ndarray) -> np.ndarray:
    """Tangent-space normals from elevation. Sobel gradients in metres per metre, longitude wraps."""
    h_m = (dn.astype(np.float32) - 20000.0) * 0.5
    rows, cols = h_m.shape
    lat = np.deg2rad(90.0 - (np.arange(rows, dtype=np.float32) + 0.5) * 180.0 / rows)
    left, right = np.roll(h_m, 1, axis=1), np.roll(h_m, -1, axis=1)
    up = np.vstack([h_m[:1], h_m[:-1]])
    down = np.vstack([h_m[1:], h_m[-1:]])
    # Sobel: east derivative (per pixel) and north derivative (per pixel; row index grows southward)
    def lr(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return np.roll(a, 1, axis=1), np.roll(a, -1, axis=1)
    ul, ur = lr(up)
    dl, dr = lr(down)
    d_east = ((ur + 2 * right + dr) - (ul + 2 * left + dl)) / 8.0
    d_north = ((ul + 2 * up + ur) - (dl + 2 * down + dr)) / 8.0
    cell_ns = MOON_RADIUS_M * np.pi / rows
    cell_ew = np.maximum(MOON_RADIUS_M * np.cos(lat) * 2 * np.pi / cols, cell_ns * 0.05)[:, None]
    nx = -NORMAL_STRENGTH * d_east / cell_ew
    ny = -NORMAL_STRENGTH * d_north / cell_ns
    nz = np.ones_like(nx)
    n = np.stack([nx, ny, nz], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip((n * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    color = tifffile.imread(src / "lroc_color_poles_8k.tif")
    if color.ndim != 3 or color.shape[0] * 2 != color.shape[1]:
        raise SystemExit(f"unexpected colour shape {color.shape}")
    if color.dtype != np.uint8:
        color = (color.astype(np.float32) / np.iinfo(color.dtype).max * 255).astype(np.uint8)
    color = color[..., :3]
    orientation = check_orientation(color)
    print("orientation", orientation)

    dem = tifffile.imread(src / "ldem_16_uint.tif")
    if dem.dtype != np.uint16 or dem.shape != (2880, 5760):
        raise SystemExit(f"unexpected elevation {dem.dtype} {dem.shape}")
    h_m = (dem.astype(np.float32) - 20000.0) * 0.5
    elev = {"minM": float(h_m.min()), "maxM": float(h_m.max())}
    if not (-10000 < elev["minM"] < -7000 and 9000 < elev["maxM"] < 12000):
        raise SystemExit(f"ELEVATION RANGE CHECK FAILED: {elev}")
    print("elevation", elev)

    files: list[Path] = []
    img = Image.fromarray(color, "RGB")
    for name, width in (("color_2k.webp", 2048), ("color_4k.webp", 4096), ("color_8k.webp", 8192)):
        p = out / name
        im = img if width == img.width else img.resize((width, width // 2), Image.LANCZOS)
        im.save(p, "WEBP", quality=WEBP_QUALITY, method=6)
        if width == 8192 and p.stat().st_size > MAX_8K_BYTES:
            p.unlink()
            p = out / "color_6k.webp"
            img.resize((6144, 3072), Image.LANCZOS).save(p, "WEBP", quality=WEBP_QUALITY, method=6)
        files.append(p)

    nrm = Image.fromarray(normal_map(dem), "RGB")
    for name, width in (("normal_2k.webp", 2048), ("normal_4k.webp", 4096)):
        p = out / name
        nrm.resize((width, width // 2), Image.LANCZOS).save(p, "WEBP", quality=90, method=6)
        files.append(p)

    meta = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "name": "NASA SVS CGI Moon Kit",
            "page": SVS_PAGE,
            "files": [SVS_BASE + "lroc_color_poles_8k.tif", SVS_BASE + "ldem_16_uint.tif"],
            "credit": "NASA/Goddard/Scientific Visualization Studio; LRO LROC (ASU) and LOLA teams",
            "note": "optimized for aesthetics, not science",
        },
        "projection": "equirectangular, centred on 0 deg longitude, north up",
        "normalStrength": NORMAL_STRENGTH,
        "checks": {"orientation": orientation, "elevation": elev},
        "files": [{"name": p.name, "bytes": p.stat().st_size, "sha256": sha256(p),
                   "width": Image.open(p).width, "height": Image.open(p).height} for p in files],
    }
    (out / "moon_meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    for f in meta["files"]:
        print(f["name"], f["bytes"], f["sha256"][:16])
    print("RESULT: PASS")


if __name__ == "__main__":
    main()
