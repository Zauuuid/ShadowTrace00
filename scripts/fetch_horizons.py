"""
Fetch Sun and Earth geometry for the Moon from NASA JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api)
and write a compact hourly ephemeris file for the site.

Why precomputed: the Horizons API has no CORS header, so a browser page cannot call it. No API key is needed.

One OBSERVER query, target Moon (301), observer Earth geocentre (500@399), quantities:
  14 = ObsSub-LON/LAT : sub-Earth point on the Moon (east-positive, MOON_ME frame, Moon is a sphere in Horizons)
  15 = SunSub-LON/LAT : sub-solar point on the Moon
  19 = r              : Sun-Moon distance (au)
  20 = delta          : Earth-Moon distance (au)
Topocentric az/el for any lunar site is then computed from these vectors (with parallax), and checked against
direct topocentric Horizons queries by scripts/verify_horizons.py.

Usage: python -I scripts/fetch_horizons.py public/data
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
AU_KM = 149597870.7
def _chunks() -> list[tuple[str, str]]:
    """6-month chunks from 2026-11-01 to 2035-12-31 23:00 (each request stays well under Horizons' line limit)."""
    out = [("2026-11-01 00:00", "2026-12-31 23:00")]
    for y in range(2027, 2036):
        out += [(f"{y}-01-01 00:00", f"{y}-06-30 23:00"), (f"{y}-07-01 00:00", f"{y}-12-31 23:00")]
    return out


CHUNKS = _chunks()


def query(start: str, stop: str) -> str:
    params = {
        "format": "json", "COMMAND": "'301'", "CENTER": "'500@399'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": "'1 h'", "QUANTITIES": "'14,15,19,20'", "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=180) as r:
        payload = json.loads(r.read().decode("utf-8"))
    if "result" not in payload:
        raise SystemExit(f"Horizons error: {payload}")
    return payload["result"]


def parse(result: str):
    if "MOON_ME" not in result:
        raise SystemExit("unexpected body frame (expected MOON_ME)")
    head, body = result.split("$$SOE", 1)
    body = body.split("$$EOE", 1)[0]
    header_line = [l for l in head.splitlines() if "ObsSub-LON" in l][0]
    cols = [c.strip() for c in header_line.split(",")]
    idx = {name: cols.index(name) for name in ("ObsSub-LON", "ObsSub-LAT", "SunSub-LON", "SunSub-LAT", "r", "delta")}
    rows = []
    for line in body.strip().splitlines():
        f = [c.strip() for c in line.split(",")]
        rows.append((f[0], *(float(f[idx[k]]) for k in ("ObsSub-LON", "ObsSub-LAT", "SunSub-LON", "SunSub-LAT", "r", "delta"))))
    return rows


def lon180(x: float) -> float:
    return ((x + 180.0) % 360.0) - 180.0


def main() -> None:
    out = Path(sys.argv[1])
    rows = []
    for a, b in CHUNKS:
        part = parse(query(a, b))
        print(f"{a} .. {b}: {len(part)} rows")
        rows.extend(part)
    if len(rows) != len({r[0] for r in rows}):
        raise SystemExit("duplicate timestamps")
    data = {
        "source": "NASA JPL Horizons API, DE441, observer table: target Moon (301), centre Earth geocentre (500@399), quantities 14,15,19,20, frame MOON_ME",
        "url": API,
        "startUtc": "2026-11-01T00:00:00Z",
        "stepHours": 1,
        "count": len(rows),
        "firstRow": rows[0][0], "lastRow": rows[-1][0],
        "conventions": "longitudes east-positive in [-180,180), planetocentric latitude (Moon is a sphere in Horizons), distances in km",
        "earthLon": [round(lon180(r[1]), 5) for r in rows],
        "earthLat": [round(r[2], 5) for r in rows],
        "sunLon": [round(lon180(r[3]), 5) for r in rows],
        "sunLat": [round(r[4], 5) for r in rows],
        "sunKm": [round(r[5] * AU_KM) for r in rows],
        "earthKm": [round(r[6] * AU_KM, 1) for r in rows],
    }
    path = out / "ephemeris.json"
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size // 1024} KB, {len(rows)} hourly rows, {rows[0][0]} .. {rows[-1][0]})")


if __name__ == "__main__":
    main()
