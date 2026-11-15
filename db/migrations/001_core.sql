-- SHADOWTRACE database, migration 001: core schema (plain PostgreSQL ≥ 14, no extensions).
-- Four origins are kept in separate schemas so a value's class is visible from its table name:
--   nasa  = REAL NASA DATA (as ingested, never modified)      calc = CALCULATED RESULTS (engine outputs)
--   demo  = SYNTHETIC DEMONSTRATION DATA (never mixed in)      app  = USER INPUTS (projects, spacecraft, missions)
--   prov  = provenance / lineage for all of the above
-- Coordinates: planetocentric lat/lon on the 1737.4 km IAU Moon sphere, plus south-polar-stereographic x/y (m)
-- as used by LOLA polar products and NASA Moon Trek. Migration 002 adds PostGIS geometry + GIST indexes.
BEGIN;

CREATE SCHEMA IF NOT EXISTS prov;
CREATE SCHEMA IF NOT EXISTS nasa;
CREATE SCHEMA IF NOT EXISTS calc;
CREATE SCHEMA IF NOT EXISTS demo;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS prov.schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

DO $$ BEGIN
  CREATE TYPE prov.origin AS ENUM ('nasa', 'calc', 'demo', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE calc.verdict AS ENUM ('suitable', 'conditional', 'unsuitable', 'insufficient');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE calc.confidence AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------ provenance
CREATE TABLE IF NOT EXISTS prov.dataset (
  id                  text PRIMARY KEY,                     -- e.g. lola-ldem-85s-20m
  name                text NOT NULL,
  instrument          text NOT NULL,
  source              text NOT NULL,
  access              text NOT NULL,                        -- documented public access method
  status              text NOT NULL CHECK (status IN ('ingested', 'investigated')),
  origin              prov.origin NOT NULL,
  spatial_resolution  text,
  coverage            text,
  temporal_coverage   text,
  coordinate_system   text,
  units               text,
  format              text,
  processing          text,
  limitations         text NOT NULL,
  source_sha256       text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prov.ingestion_run (
  id            bigserial PRIMARY KEY,
  dataset_id    text NOT NULL REFERENCES prov.dataset(id),
  script        text NOT NULL,                              -- e.g. db/ingest/load.py
  code_version  text NOT NULL,                              -- git commit of the loader
  input_sha256  text CHECK (input_sha256 IS NULL OR input_sha256 ~ '^[0-9a-f]{64}$'),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_loaded   bigint CHECK (rows_loaded IS NULL OR rows_loaded >= 0),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  error         text,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ingestion_run_dataset_idx ON prov.ingestion_run (dataset_id, started_at DESC);

-- ------------------------------------------------------------------ REAL NASA DATA
CREATE TABLE IF NOT EXISTS nasa.lunar_region (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('artemis3', 'psr')),
  label         text NOT NULL,
  feature       text,
  area_km2      double precision CHECK (area_km2 IS NULL OR area_km2 > 0),
  x_m           double precision NOT NULL,                  -- representative point (polar stereographic)
  y_m           double precision NOT NULL,
  ring_xy       jsonb,                                       -- polygon ring [[x,y],...] when published as polygon
  run_id        bigint NOT NULL REFERENCES prov.ingestion_run(id),
  UNIQUE (kind, label)
);

CREATE TABLE IF NOT EXISTS nasa.named_feature (
  name          text PRIMARY KEY,
  kind          text NOT NULL,
  lat_deg       double precision NOT NULL CHECK (lat_deg BETWEEN -90 AND 90),
  lon_deg       double precision NOT NULL CHECK (lon_deg >= -180 AND lon_deg <= 180),
  diameter_km   double precision NOT NULL CHECK (diameter_km >= 0),
  run_id        bigint NOT NULL REFERENCES prov.ingestion_run(id)
);

CREATE TABLE IF NOT EXISTS nasa.elevation_product (
  product_id          text PRIMARY KEY,                      -- LDEM_75S_240M, LDEM_85S_20M
  dataset_id          text NOT NULL REFERENCES prov.dataset(id),
  map_scale_m         double precision NOT NULL CHECK (map_scale_m > 0),
  grid_size_px        integer NOT NULL CHECK (grid_size_px > 0),
  scaling_factor_m    double precision NOT NULL CHECK (scaling_factor_m > 0),
  reference_radius_m  double precision NOT NULL CHECK (reference_radius_m = 1737400),
  min_lat_deg         double precision NOT NULL CHECK (min_lat_deg BETWEEN -90 AND -60),
  origin_sample       double precision NOT NULL,
  origin_line         double precision NOT NULL,
  derived_scale_m     double precision NOT NULL,             -- scale of the derived file actually served
  served_uri          text NOT NULL,                          -- public/data/... path
  source_sha256       text,
  run_id              bigint NOT NULL REFERENCES prov.ingestion_run(id)
);

CREATE TABLE IF NOT EXISTS nasa.elevation_tile (
  product_id   text NOT NULL REFERENCES nasa.elevation_product(product_id),
  tile_row     smallint NOT NULL CHECK (tile_row >= 0),
  tile_col     smallint NOT NULL CHECK (tile_col >= 0),
  x0_m double precision NOT NULL, y0_m double precision NOT NULL, x1_m double precision NOT NULL, y1_m double precision NOT NULL,
  uri          text NOT NULL,
  bytes        integer NOT NULL CHECK (bytes > 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (product_id, tile_row, tile_col),
  CHECK (x1_m > x0_m AND y1_m > y0_m)
);

CREATE TABLE IF NOT EXISTS nasa.ephemeris_sample (
  body          text NOT NULL CHECK (body IN ('sun', 'earth')),
  t_utc         timestamptz NOT NULL,
  sub_lat_deg   double precision NOT NULL CHECK (sub_lat_deg BETWEEN -90 AND 90),
  sub_lon_deg   double precision NOT NULL CHECK (sub_lon_deg >= -180 AND sub_lon_deg <= 180),
  distance_km   double precision NOT NULL CHECK (distance_km > 0),
  run_id        bigint NOT NULL REFERENCES prov.ingestion_run(id),
  PRIMARY KEY (body, t_utc)
);

-- Diviner thermal: schema ready, NOT populated (see docs/LIMITATIONS.md). Never filled with estimates.
CREATE TABLE IF NOT EXISTS nasa.thermal_observation (
  id            bigserial PRIMARY KEY,
  product       text NOT NULL,                              -- e.g. PCP summer max
  x_m double precision NOT NULL, y_m double precision NOT NULL,
  season        text, local_time_h double precision, subsolar_lon_deg double precision,
  t_bol_k       double precision NOT NULL CHECK (t_bol_k > 0 AND t_bol_k < 450),
  run_id        bigint NOT NULL REFERENCES prov.ingestion_run(id)
);

-- ------------------------------------------------------------------ USER INPUTS
CREATE TABLE IF NOT EXISTS app.user_project (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  owner       text,                                          -- auth subject when accounts are enabled
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.spacecraft_profile (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES app.user_project(id) ON DELETE CASCADE,
  name             text NOT NULL,
  array_area_m2    double precision NOT NULL CHECK (array_area_m2 > 0 AND array_area_m2 <= 200),
  array_eff        double precision NOT NULL CHECK (array_eff > 0 AND array_eff <= 0.5),
  battery_wh       double precision NOT NULL CHECK (battery_wh > 0 AND battery_wh <= 500000),
  usable_frac      double precision NOT NULL CHECK (usable_frac > 0 AND usable_frac <= 1),
  day_load_w       double precision NOT NULL CHECK (day_load_w >= 0),
  night_load_w     double precision NOT NULL CHECK (night_load_w >= 0),
  panel            text NOT NULL CHECK (panel IN ('tracking', 'fixed', 'horizontal')),
  fixed_az_deg     double precision NOT NULL DEFAULT 0 CHECK (fixed_az_deg >= 0 AND fixed_az_deg < 360),
  mast_m           double precision NOT NULL CHECK (mast_m >= 0 AND mast_m <= 50),
  leg_span_m       double precision NOT NULL CHECK (leg_span_m > 0 AND leg_span_m <= 30),
  max_slope_deg    double precision NOT NULL CHECK (max_slope_deg > 0 AND max_slope_deg <= 45),
  mass_kg          double precision CHECK (mass_kg IS NULL OR mass_kg > 0),
  footprint_m      double precision CHECK (footprint_m IS NULL OR footprint_m > 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.mission_configuration (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid REFERENCES app.user_project(id) ON DELETE CASCADE,
  spacecraft_id       uuid NOT NULL REFERENCES app.spacecraft_profile(id),
  site_lat_deg        double precision NOT NULL CHECK (site_lat_deg BETWEEN -90 AND -75),
  site_lon_deg        double precision NOT NULL CHECK (site_lon_deg >= -180 AND site_lon_deg <= 180),
  start_utc           timestamptz NOT NULL,
  end_utc             timestamptz NOT NULL,
  disp_north_m double precision NOT NULL CHECK (disp_north_m >= 0), disp_east_m double precision NOT NULL CHECK (disp_east_m >= 0),
  disp_south_m double precision NOT NULL CHECK (disp_south_m >= 0), disp_west_m double precision NOT NULL CHECK (disp_west_m >= 0),
  min_p_safe          double precision NOT NULL CHECK (min_p_safe > 0 AND min_p_safe < 1),
  sigma_level         double precision NOT NULL CHECK (sigma_level >= 1 AND sigma_level <= 5),
  samples             integer NOT NULL CHECK (samples BETWEEN 100 AND 10000),
  min_earth_el_deg    double precision NOT NULL,
  max_blackout_h      double precision NOT NULL CHECK (max_blackout_h > 0),
  share_hash          text,                                  -- the #m=… link that reproduces it in the app
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_utc > start_utc)
);

-- ------------------------------------------------------------------ CALCULATED RESULTS
CREATE TABLE IF NOT EXISTS calc.landing_simulation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      uuid NOT NULL REFERENCES app.mission_configuration(id) ON DELETE CASCADE,
  engine_version  text NOT NULL,                             -- git commit of src/planner
  seed            bigint NOT NULL,
  samples         integer NOT NULL CHECK (samples > 0),
  valid_samples   integer NOT NULL CHECK (valid_samples >= 0),
  p_safe          double precision NOT NULL CHECK (p_safe BETWEEN 0 AND 1),
  ci95_lo         double precision NOT NULL CHECK (ci95_lo BETWEEN 0 AND 1),
  ci95_hi         double precision NOT NULL CHECK (ci95_hi BETWEEN 0 AND 1),
  coverage_pct    double precision NOT NULL CHECK (coverage_pct BETWEEN 0 AND 100),
  grid_m          double precision NOT NULL CHECK (grid_m IN (40, 240)),
  baseline_m      double precision NOT NULL CHECK (baseline_m > 0),
  slope_mean_deg  double precision, slope_p95_deg double precision, relief_p95_m double precision,
  inputs_sha256   text NOT NULL,                             -- hash of every input → cache key
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ci95_lo <= p_safe AND p_safe <= ci95_hi)
);

CREATE TABLE IF NOT EXISTS calc.touchdown_sample (
  simulation_id  uuid NOT NULL REFERENCES calc.landing_simulation(id) ON DELETE CASCADE,
  idx            integer NOT NULL CHECK (idx >= 0),
  east_m double precision NOT NULL, north_m double precision NOT NULL,
  x_m double precision NOT NULL, y_m double precision NOT NULL,
  slope_deg      double precision,
  relief_m       double precision,
  cause          text NOT NULL CHECK (cause IN ('ok', 'slope', 'nodata')),
  PRIMARY KEY (simulation_id, idx)
);

CREATE TABLE IF NOT EXISTS calc.landing_footprint (
  simulation_id  uuid PRIMARY KEY REFERENCES calc.landing_simulation(id) ON DELETE CASCADE,
  sigma_level    double precision NOT NULL,
  ring_xy        jsonb NOT NULL                              -- k-sigma ellipse ring in polar stereographic metres
);

CREATE TABLE IF NOT EXISTS calc.suitability_result (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      uuid NOT NULL REFERENCES app.mission_configuration(id) ON DELETE CASCADE,
  simulation_id   uuid NOT NULL REFERENCES calc.landing_simulation(id) ON DELETE CASCADE,
  verdict         calc.verdict NOT NULL,
  score           smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence      calc.confidence NOT NULL,
  coverage_pct    double precision NOT NULL CHECK (coverage_pct BETWEEN 0 AND 100),
  factors         jsonb NOT NULL,                            -- [{id, score, status}]
  findings        jsonb NOT NULL,                            -- [{tone, code, p}] — rendered bilingually by the app
  longest_dark_h  double precision, longest_blackout_h double precision, min_soc_pct double precision,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (verdict <> 'unsuitable' OR score <= 35)              -- a hard failure can never rank high
);

CREATE TABLE IF NOT EXISTS calc.alternative_candidate (
  result_id      uuid NOT NULL REFERENCES calc.suitability_result(id) ON DELETE CASCADE,
  rank           smallint NOT NULL CHECK (rank BETWEEN 1 AND 5),
  lat_deg double precision NOT NULL, lon_deg double precision NOT NULL,
  distance_m     double precision NOT NULL CHECK (distance_m >= 0),
  azimuth_deg    double precision NOT NULL,
  verdict        calc.verdict NOT NULL,
  score          smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence     calc.confidence NOT NULL,
  p_safe         double precision NOT NULL CHECK (p_safe BETWEEN 0 AND 1),
  coverage_pct   double precision NOT NULL CHECK (coverage_pct >= 95),   -- evidence requirement
  longest_dark_h double precision, longest_blackout_h double precision, min_soc_pct double precision,
  pros jsonb NOT NULL, cons jsonb NOT NULL, reason jsonb NOT NULL,
  PRIMARY KEY (result_id, rank)
);

-- Cache: identical inputs + engine version → identical result (the engine is deterministic).
CREATE TABLE IF NOT EXISTS calc.assessment_cache (
  inputs_sha256   text NOT NULL,
  engine_version  text NOT NULL,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  hits            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (inputs_sha256, engine_version)
);

-- ------------------------------------------------------------------ SYNTHETIC DEMONSTRATION DATA
-- Kept physically apart; nothing in calc.* may reference demo.*. Every row is labelled synthetic.
CREATE TABLE IF NOT EXISTS demo.synthetic_terrain (
  id          bigserial PRIMARY KEY,
  label       text NOT NULL DEFAULT 'SYNTHETIC — not NASA data' CHECK (label LIKE 'SYNTHETIC%'),
  purpose     text NOT NULL,                                 -- e.g. unit-test plane at 15°
  params      jsonb NOT NULL
);

-- ------------------------------------------------------------------ lineage view
CREATE OR REPLACE VIEW prov.result_lineage AS
SELECT r.id AS result_id, r.verdict, r.score, s.engine_version, s.seed, s.grid_m, s.inputs_sha256,
       m.id AS mission_id, m.share_hash,
       (SELECT jsonb_agg(jsonb_build_object('dataset', d.id, 'status', d.status, 'origin', d.origin, 'sha256', d.source_sha256))
          FROM prov.dataset d WHERE d.status = 'ingested' AND d.origin = 'nasa') AS nasa_inputs
FROM calc.suitability_result r
JOIN calc.landing_simulation s ON s.id = r.simulation_id
JOIN app.mission_configuration m ON m.id = r.mission_id;

INSERT INTO prov.schema_migration (version) VALUES ('001_core') ON CONFLICT DO NOTHING;
COMMIT;
