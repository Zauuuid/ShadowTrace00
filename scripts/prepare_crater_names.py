"""
Extract official IAU lunar feature names for the globe labels (run once; output is committed).

Input (downloaded into data-raw/iau/, not committed):
  - MOON_nomenclature_center_pts.zip  IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology),
    https://planetarynames.wr.usgs.gov/GIS_Downloads  (shapefile; we read only the .dbf table)

Output (public/data/):
  - lunar_names.json  compact list [name, lat, lonEast(-180..180), diameterKm, kind]
      * every adopted feature (except lettered satellite craters) at or south of SOUTH_LAT
      * plus large features (diameter >= GLOBAL_MIN_KM) anywhere, for context when zoomed out
  - SOURCES.json gains a "names" entry (file checksum, feature counts)

Usage:
  python -I scripts/prepare_crater_names.py <data-raw dir> <public/data dir>
"""

import hashlib
import io
import json
import struct
import sys
import zipfile
from pathlib import Path

SOUTH_LAT = -60.0
GLOBAL_MIN_KM = 150.0
ZIP_NAME = "iau/MOON_nomenclature_center_pts.zip"
KINDS = {"AA": "crater", "MO": "mons", "MA": "mare", "PL": "planitia", "VA": "vallis", "RU": "rupes", "DO": "dorsum", "PR": "promontorium", "LC": "lacus", "SI": "sinus", "PA": "palus", "OC": "oceanus", "CA": "catena"}


def read_dbf(data: bytes):
    n, hlen, rlen = struct.unpack("<IHH", data[4:12])
    fields, off = [], 32
    while data[off] != 0x0D:
        d = data[off : off + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        off += 32
    for i in range(n):
        r = data[hlen + i * rlen : hlen + (i + 1) * rlen]
        if r[:1] == b"*":  # deleted record
            continue
        pos, rec = 1, {}
        for name, length in fields:
            rec[name] = r[pos : pos + length].decode("utf-8", "replace").strip()
            pos += length
        yield rec


def main() -> None:
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    zpath = raw / ZIP_NAME
    digest = hashlib.sha256(zpath.read_bytes()).hexdigest()
    with zipfile.ZipFile(zpath) as z:
        dbf_name = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
        data = z.read(dbf_name)

    rows, total = [], 0
    for rec in read_dbf(data):
        total += 1
        code = rec["code"]
        if code not in KINDS or not rec["approval"].startswith("Adopted"):
            continue
        lat = float(rec["center_lat"])
        lon = float(rec["center_lon"])
        lon = ((lon + 180.0) % 360.0) - 180.0
        dia = float(rec["diameter"] or 0)
        if lat <= SOUTH_LAT or dia >= GLOBAL_MIN_KM:
            rows.append([rec["clean_name"] or rec["name"], round(lat, 3), round(lon, 3), round(dia, 1), KINDS[code]])

    rows.sort(key=lambda r: -r[3])
    names = {r[0] for r in rows}
    for must in ("Shackleton", "Faustini", "Haworth", "Shoemaker", "de Gerlache", "Amundsen", "Cabeus"):
        if must not in names:
            raise SystemExit(f"sanity check failed: {must} missing")
    payload = {
        "source": "IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology), MOON_nomenclature_center_pts",
        "url": "https://planetarynames.wr.usgs.gov/",
        "fields": ["name", "latDeg", "lonDegEast", "diameterKm", "kind"],
        "southLatDeg": SOUTH_LAT,
        "globalMinDiameterKm": GLOBAL_MIN_KM,
        "features": rows,
    }
    (out / "lunar_names.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    src_path = out / "SOURCES.json"
    src = json.loads(src_path.read_text()) if src_path.exists() else {}
    src["names"] = {"file": "MOON_nomenclature_center_pts.zip", "sha256": digest, "records": total, "kept": len(rows)}
    src_path.write_text(json.dumps(src, indent=2))
    print(json.dumps({"records": total, "kept": len(rows), "south": sum(1 for r in rows if r[1] <= SOUTH_LAT)}))


if __name__ == "__main__":
    main()
