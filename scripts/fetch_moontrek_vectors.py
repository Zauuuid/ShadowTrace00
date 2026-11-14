"""
Fetch NASA Moon Trek south-pole vector layers (ArcGIS feature services listed by Moon Trek's getLayerServices):
  - A3_Named_regions_SP : Artemis III Candidate Landing Regions, S Pole (13 regions)
  - PSR_SP              : Permanently Shadowed Regions (PSRs), S Pole
Coordinates are kept in the services' own projection, Moon2000 south polar stereographic (R = 1737400 m),
which is the projection used by src/planner/polar.ts and by the Moon Trek south-pole tiles.

Usage: python -I scripts/fetch_moontrek_vectors.py public/data
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

LAYERS = {
    "artemis3": "https://trek.nasa.gov/moon/trekarcgis2/rest/services/A3_Named_regions_SP/MapServer/0/query",
    "psr": "https://trek.nasa.gov/moon/trekarcgis/rest/services/PSR_SP/MapServer/0/query",
}


def fetch(url: str, offset_m: float) -> dict:
    q = {"where": "1=1", "outFields": "*", "f": "json", "returnGeometry": "true", "maxAllowableOffset": str(offset_m)}
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(q), timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> None:
    out = {"source": "NASA Moon Trek (trek.nasa.gov) ArcGIS feature services", "projection": "Moon2000 south polar stereographic, metres, R=1737400"}
    for key, url in LAYERS.items():
        d = fetch(url, 20 if key == "artemis3" else 60)
        wkt = d.get("spatialReference", {}).get("wkt", "")
        if "Stereographic_South_Pole" not in wkt or "1737400" not in wkt:
            raise SystemExit(f"{key}: unexpected projection {wkt[:120]}")
        feats = []
        skipped = 0
        for f in d["features"]:
            g = f.get("geometry", {})
            if "x" in g and "y" in g:
                a = f["attributes"]
                feats.append({"label": a.get("PSR_ID") or "", "point": [round(g["x"], 1), round(g["y"], 1)],
                              "areaKm2": a.get("Area__km2_"), "feature": a.get("Lunar_Feat") or ""})
                continue
            if not g.get("rings"):
                skipped += 1  # polygon smaller than the simplification tolerance
                continue
            rings = [[[round(x, 1), round(y, 1)] for x, y in ring] for ring in f["geometry"]["rings"]]
            label = f["attributes"].get("label") or f["attributes"].get("Name") or f["attributes"].get("NAME") or ""
            feats.append({"label": label, "rings": rings})
        out[key] = {"url": url.rsplit("/query", 1)[0], "count": len(feats), "features": feats}
        print(f"{key}: {len(feats)} features ({skipped} smaller than the {60 if key == 'psr' else 20} m tolerance skipped)")
    p = Path(sys.argv[1]) / "moontrek_vectors.json"
    p.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {p} ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
