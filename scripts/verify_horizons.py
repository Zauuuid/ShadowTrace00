"""
Verify public/data/ephemeris.json: topocentric Sun/Earth azimuth and elevation computed from the file
(the same maths as src/engine/ephemeris.ts) must match direct topocentric JPL Horizons queries
(CENTER='coord@301', airless apparent az/el) at lunar south-pole sites.

Usage: python -I scripts/verify_horizons.py public/data
Exit code 1 if any difference exceeds the tolerance.
"""

import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
R_KM = 1737.4
TOL_DEG = 0.02
SITES = [("Spudis ridge", -89.445, -138.468, 1.954), ("de Gerlache ridge", -88.677, -68.421, 1.809),
         ("Slater plateau", -88.796, 123.742, 1.646), ("Haynes low", -88.236, 153.492, 0.502)]
WINDOWS = [("2026-12-03 05:00", "2026-12-20 05:00", "17 h"), ("2027-08-11 00:00", "2027-09-02 00:00", "13 h"),
           ("2028-05-01 03:00", "2028-05-29 03:00", "19 h"),
           ("2031-03-01 00:00", "2031-03-20 00:00", "17 h"), ("2035-10-01 00:00", "2035-10-20 00:00", "17 h")]


def unit(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))


def interp(eph, key, t_hours):
    i = int(math.floor(t_hours)); f = t_hours - i
    a, b = eph[key][i], eph[key][i + 1]
    if key.endswith("Lon"):
        d = ((b - a + 540) % 360) - 180
        return a + d * f
    return a + (b - a) * f


def azel(eph, lat, lon, h_km, t_hours, body):
    blat = interp(eph, body + "Lat", t_hours); blon = interp(eph, body + "Lon", t_hours)
    dist = interp(eph, body + "Km", t_hours)
    b = [dist * c for c in unit(blat, blon)]
    p = [(R_KM + h_km) * c for c in unit(lat, lon)]
    d = [b[k] - p[k] for k in range(3)]
    n = math.sqrt(sum(x * x for x in d)); d = [x / n for x in d]
    la, lo = math.radians(lat), math.radians(lon)
    up = unit(lat, lon)
    east = (-math.sin(lo), math.cos(lo), 0.0)
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    dot = lambda u, v: sum(u[k] * v[k] for k in range(3))
    el = math.degrees(math.asin(dot(d, up)))
    az = math.degrees(math.atan2(dot(d, east), dot(d, north))) % 360
    return az, el


def horizons(body, lat, lon, h_km, start, stop, step):
    params = {"format": "json", "COMMAND": f"'{body}'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
              "SITE_COORD": f"'{lon},{lat},{h_km}'", "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
              "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'", "QUANTITIES": "'4'",
              "APPARENT": "'AIRLESS'", "CSV_FORMAT": "'YES'", "ANG_FORMAT": "'DEG'", "EXTRA_PREC": "'YES'"}
    with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(params), timeout=120) as r:
        res = json.loads(r.read().decode())["result"]
    body_rows = res.split("$$SOE", 1)[1].split("$$EOE", 1)[0].strip().splitlines()
    out = []
    for line in body_rows:
        f = [c.strip() for c in line.split(",")]
        t = datetime.strptime(f[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        nums = [x for x in f[1:] if x and x.replace(".", "", 1).replace("-", "", 1).isdigit()]
        out.append((t, float(nums[0]), float(nums[1])))
    return out


def main():
    eph = json.loads((Path(sys.argv[1]) / "ephemeris.json").read_text(encoding="utf-8"))
    t0 = datetime(2026, 11, 1, tzinfo=timezone.utc)
    worst = {"sun": [0, 0], "earth": [0, 0]}
    n = 0
    for name, lat, lon, h in SITES:
        for start, stop, step in WINDOWS:
            for body, code in (("sun", "10"), ("earth", "399")):
                for t, az_h, el_h in horizons(code, lat, lon, h, start, stop, step):
                    th = (t - t0).total_seconds() / 3600
                    az, el = azel(eph, lat, lon, h, th, body)
                    daz = abs(((az - az_h + 540) % 360) - 180) * math.cos(math.radians(el_h))
                    del_ = abs(el - el_h)
                    worst[body][0] = max(worst[body][0], daz); worst[body][1] = max(worst[body][1], del_)
                    n += 1
        print(f"{name}: done")
    print(f"{n} comparisons")
    for b in worst:
        print(f"{b}: max |d az|*cos(el) = {worst[b][0]:.5f} deg, max |d el| = {worst[b][1]:.5f} deg")
    bad = any(v > TOL_DEG for b in worst for v in worst[b])
    print("RESULT:", "FAIL" if bad else f"PASS (tolerance {TOL_DEG} deg)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
