# SHADOWTRACE — Repository audit (v3 → v4)

Repository: `Zauuuid/shadowtrace1` · audited commit `2001ef1` (branch `main`, single squashed commit "ShadowTrace") · 2026-11-15.

## What exists

| Area | Finding |
|---|---|
| Architecture | Static Vite + React 19 + TypeScript SPA. No server, no database. All NASA products are pre-processed by Python scripts into `public/data/` (≈113 MB) and evaluated in the browser by a pure, deterministic TypeScript engine. |
| Engine (`src/planner/`) | Real and well-tested: JPL Horizons Sun/Earth ephemeris (hourly 2026-11 → 2035-12, verified against live Horizons to 0.006°), LOLA polar-stereographic terrain (40 m tiles near the pole, 240 m to 75°S), terrain horizon, solar-power + battery simulation, Earth line-of-sight, slope over an asymmetric dispersion ellipse, nearby-site and nearby-date alternatives. |
| Data scripts (`scripts/`) | Reproducible ingestion: `fetch_horizons.py`, `verify_horizons.py`, `prepare_lola240.py`, `prepare_dem40.py`, `prepare_suitability.py`, `fetch_moontrek_vectors.py`, `prepare_crater_names.py`, `write_sources.py`. Provenance summary in `public/data/SOURCES.json`. |
| UI | 6-step wizard (dates → spacecraft → site → error margin → result → report), three.js "Journey" intro using NASA SVS CGI Moon Kit textures, Arabic-first i18n with RTL, print report, shareable link. |
| Tests | Vitest: `planner.test.ts` (engine reference results), `journey.test.ts`, `share.test.ts`, `helpers.test.ts`, `data.test.ts`. |
| Deploy | GitHub Pages workflow; README says Vercel works with zero config. |
| Git | One branch (`main`), one commit. No secrets found in tracked files. |

## Classification

### KEEP
- **The whole data layer and ingestion scripts.** They use real, documented public NASA sources with verification (Horizons diff check, orientation checks). This is the scientific backbone and is better than anything a rewrite would produce in the same time.
- **Engine modules** `ephemeris.ts`, `terrain.ts`, `horizon.ts`, `polar.ts`, `mission.ts`: pure, deterministic, unit-tested.
- **i18n architecture** (Arabic-first, RTL via `dir` on `<html>`), share links, print report.
- **Static-first deployment.** Every scientific number is reproducible from files in the repo; no runtime dependency on NASA uptime.

### IMPROVE
- `landing.ts`: evaluates the *worst* slope inside the ellipse only. It has no probability model, no roughness, no notion of how likely the lander is to touch down on bad ground. → add a seeded Monte-Carlo touchdown model with confidence intervals (`uncertainty.ts`).
- `alternatives.ts`: ranks by minimum battery state of charge only; candidates do not carry terrain-footprint risk, data confidence, pros/cons or a reason. → wrap with a scoring layer that reuses the same simulation and adds footprint risk and evidence.
- Verdict: binary *Suitable / Rejected*. The brief requires *Suitable / Conditional / Unsuitable*, a score, confidence and data coverage. → `assess.ts`.
- Result screen: dense; the 5-second read is not guaranteed. → verdict hero + descent view + reasons first, details behind Expert mode.
- Provenance: sources are listed, but individual numbers on screen are not tagged with their origin class. → `provenance.ts` with four classes (NASA data / calculated / synthetic demo / user input).

### REPLACE
- Visual identity tokens → refined lunar colour system mapped to scientific meaning (safe / hazard / illumination / comms / uncertainty).
- The landing-zone panel → a descent experience whose touchdown points are exactly the Monte-Carlo samples the engine evaluated (no decorative randomness).

### REMOVE
- Nothing removed. History is preserved; v4 work lives on branch `feature/v4-landing-intelligence`.

## Gaps against the v4 brief (and decision)

| Brief item | Decision |
|---|---|
| PostgreSQL/PostGIS database | Schema, migrations, provenance tables and an ingestion loader are added under `db/`. **Not provisioned**: a hosted Postgres needs the owner to accept a provider (e.g. Neon via Vercel Marketplace). The deployed product does not depend on it; it stays static and reproducible. |
| Backend | Zero-dependency Vercel Functions under `api/` (`/api/health`, `/api/datasets`). The scientific engine stays client-side so results are identical offline and in tests. |
| Diviner thermal | Not ingested in this iteration (see `LIMITATIONS.md`). The UI states "not assessed" rather than inventing values. |
| Boulders | Not observable at 40 m LOLA resolution; would need LROC NAC (0.5 m/px) hazard mapping. Stated as a limitation. |
| Relay satellites | No public relay ephemeris for planned south-pole relays; only direct-to-Earth geometry is assessed. |
| AI/ML | No ML model is used for scientific values. Deterministic physics + sampling is more defensible for a safety decision; documented in `METHODOLOGY.md`. |

## Environment constraints met during this audit
- Read access to the repo works; **push is refused** (Claude GitHub App not installed on the `Zauuuid` account).
- npm registry is unreachable from the build workspace, so local checks use esbuild built from source and dependencies cloned from GitHub at the pinned versions; the production build runs `npm ci` + Vite on Vercel.
