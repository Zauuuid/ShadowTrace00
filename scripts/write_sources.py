"""
Write public/data/SOURCES.json (chapter 03 section 9). Keeps the "names" provenance block that
prepare_crater_names.py writes into the same file. Run after the other data scripts.

Usage: python -I scripts/write_sources.py public/data
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCES = [
    {"id": "horizons", "name": "NASA JPL Horizons", "url": "https://ssd.jpl.nasa.gov/horizons/", "period": "2026-11-01..2035-12-31",
     "resolution": "1 h", "usedFor": ["sun", "earth"], "scientific": True},
    {"id": "lola", "name": "NASA PDS LRO LOLA", "url": "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
     "resolution": "40 m / 240 m", "usedFor": ["terrain", "slope", "horizon"], "scientific": True},
    {"id": "moontrek", "name": "NASA Moon Trek", "url": "https://trek.nasa.gov/moon/", "usedFor": ["basemap", "artemis3", "psr"], "scientific": True},
    {"id": "iau", "name": "IAU / USGS Gazetteer of Planetary Nomenclature", "url": "https://planetarynames.wr.usgs.gov/",
     "usedFor": ["names"], "scientific": True},
    {"id": "svs-moonkit", "name": "NASA SVS CGI Moon Kit", "url": "https://svs.gsfc.nasa.gov/4720/", "usedFor": ["journey-visuals"],
     "scientific": False, "note": "optimized for aesthetics, not science",
     "credit": "NASA/Goddard/Scientific Visualization Studio; LRO LROC (ASU) and LOLA teams"},
]


def main() -> None:
    p = Path(sys.argv[1]) / "SOURCES.json"
    old = json.loads(p.read_text()) if p.exists() else {}
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": SOURCES}
    if "names" in old:
        out["names"] = old["names"]
    p.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {p} ({len(SOURCES)} sources)")


if __name__ == "__main__":
    main()
