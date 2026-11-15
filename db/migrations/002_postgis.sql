-- SHADOWTRACE migration 002: PostGIS geometry and spatial indexes (requires the postgis extension).
-- Lunar CRSs are registered as custom SRIDs (PostGIS ships Earth CRSs only):
--   949900 = Moon south polar stereographic, sphere R = 1737400 m (LOLA polar / Moon Trek convention)
--   949901 = Moon geographic lon/lat on the same sphere
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, proj4text, srtext) VALUES
  (949900, 'SHADOWTRACE', 949900, '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs',
   'PROJCS["Moon South Polar Stereographic (sphere 1737400)",GEOGCS["Moon 2000",DATUM["D_Moon_2000",SPHEROID["Moon_2000_IAU_IAG",1737400.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Polar_Stereographic"],PARAMETER["latitude_of_origin",-90],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["Meter",1]]'),
  (949901, 'SHADOWTRACE', 949901, '+proj=longlat +R=1737400 +no_defs',
   'GEOGCS["Moon 2000",DATUM["D_Moon_2000",SPHEROID["Moon_2000_IAU_IAG",1737400.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]]')
ON CONFLICT (srid) DO NOTHING;

ALTER TABLE nasa.lunar_region ADD COLUMN IF NOT EXISTS geom geometry(Point, 949900)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_m, y_m), 949900)) STORED;
ALTER TABLE nasa.named_feature ADD COLUMN IF NOT EXISTS geom geometry(Point, 949901)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon_deg, lat_deg), 949901)) STORED;
ALTER TABLE nasa.elevation_tile ADD COLUMN IF NOT EXISTS extent geometry(Polygon, 949900)
  GENERATED ALWAYS AS (ST_MakeEnvelope(x0_m, y0_m, x1_m, y1_m, 949900)) STORED;
ALTER TABLE nasa.thermal_observation ADD COLUMN IF NOT EXISTS geom geometry(Point, 949900)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_m, y_m), 949900)) STORED;
ALTER TABLE calc.touchdown_sample ADD COLUMN IF NOT EXISTS geom geometry(Point, 949900)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x_m, y_m), 949900)) STORED;
ALTER TABLE app.mission_configuration ADD COLUMN IF NOT EXISTS site geometry(Point, 949901)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(site_lon_deg, site_lat_deg), 949901)) STORED;
ALTER TABLE calc.alternative_candidate ADD COLUMN IF NOT EXISTS site geometry(Point, 949901)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon_deg, lat_deg), 949901)) STORED;

CREATE INDEX IF NOT EXISTS lunar_region_gix   ON nasa.lunar_region USING gist (geom);
CREATE INDEX IF NOT EXISTS named_feature_gix  ON nasa.named_feature USING gist (geom);
CREATE INDEX IF NOT EXISTS elevation_tile_gix ON nasa.elevation_tile USING gist (extent);
CREATE INDEX IF NOT EXISTS thermal_obs_gix    ON nasa.thermal_observation USING gist (geom);
CREATE INDEX IF NOT EXISTS touchdown_gix      ON calc.touchdown_sample USING gist (geom);
CREATE INDEX IF NOT EXISTS mission_site_gix   ON app.mission_configuration USING gist (site);
CREATE INDEX IF NOT EXISTS alt_site_gix       ON calc.alternative_candidate USING gist (site);

INSERT INTO prov.schema_migration (version) VALUES ('002_postgis') ON CONFLICT DO NOTHING;
COMMIT;
