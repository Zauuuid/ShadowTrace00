# SHADOWTRACE — Lunar Landing Intelligence

**Every landing begins with a decision.** Choose a spacecraft (Scout, Explorer or Pioneer — SHADOWTRACE concept
designs with illustrative specifications), pick a site near the lunar south pole on an interactive 3D Moon, watch an
illustrative launch, explore the landing zone, and get a **Suitable / Conditional / Unsuitable** decision computed from
NASA data — with up to five evidence-based alternative sites shown on the globe.

Journey: `Home → Spacecraft → Mission → Launch → Landing → Decision → Alternatives` (+ NASA data page and mission report).
Arabic-first with full RTL, and English. Basic and Expert modes.

### What is computed (and what is not)
- **Touchdown uncertainty:** seeded Monte Carlo (600 samples by default) over the k-sigma error ellipse; slope from
  NASA LOLA heights over max(leg span, 2 × grid); P(safe) with a Wilson 95 % interval. Never shown as 100 %.
- **Power & illumination:** JPL Horizons Sun + LOLA terrain horizon + the spacecraft's array and battery.
- **Earth visibility:** geometric line of sight (not signal strength).
- **Not assessed (stated in every result):** Diviner thermal, boulders smaller than the 40 m grid, relay satellites.
- The launch sequence is a **cinematic visualization, not a trajectory calculation** (labelled on screen).

See `docs/AUDIT.md`, `docs/DESIGN.md`, `public/data/catalog.json` (dataset catalog) and the in-app *NASA data* page.
Database design (PostgreSQL/PostGIS, not provisioned in the static deployment): `db/migrations/`.

## Data (NASA only)
- **Sun and Earth:** NASA JPL Horizons, hourly from Nov 2026 to Dec 2035. It matches direct Horizons queries within 0.006° (`scripts/verify_horizons.py`).
- **Terrain and horizons:** NASA LRO LOLA (PDS). Resolution is 40 m near the pole and 240 m out to 75°S.
- **Sun & Earth map layer:** a monthly colour map of the cap to 75°S, computed from LOLA + Horizons (`scripts/prepare_suitability.py`):
  - **green:** Sun and Earth up about half the month or more, on flat ground;
  - **red:** long nights, no Earth (far side), or steep ground.
- **Maps, Artemis III candidate regions, permanently shadowed regions:** NASA Moon Trek.
- **Feature names:** IAU / USGS Gazetteer of Planetary Nomenclature.
- **Spacecraft defaults:** published specs of Nova-C, Blue Ghost, Peregrine and VIPER. The lander drawing is an illustration, not a real vehicle.

Earth visibility is geometric line of sight, not signal strength.

## Run
```bash
npm ci
```
```bash
npm run dev
```

Check everything (types, lint, tests, build):
```bash
npm run check
```

## Deploy
The site is fully static: `npm run build` produces `dist/`.
- **Vercel:** import the repository. It detects Vite (build `npm run build`, output `dist`); no settings are needed.
- **GitHub Pages:** `.github/workflows/deploy.yml` publishes on every push to `main`.

## Layout
- `src/planner/`: the engine (pure TypeScript): ephemeris, terrain, horizon, power and battery, landing zone, touchdown Monte Carlo (`uncertainty.ts`), assessment (`assess.ts`), site context, fleet profiles (`fleet.ts`), alternatives and candidate evaluation.
- `src/globe/`: the interactive 3D Moon (Three.js).
- `src/screens/`: the mission-journey screens. `src/planner-ui/`: shared views (descent, findings, report).
- `scripts/`: Python scripts that build `public/data/` from NASA sources.

## AI disclosure
Built with Claude Code (Anthropic) under the team's direction. All numbers come from NASA data and deterministic calculations, not from AI.
