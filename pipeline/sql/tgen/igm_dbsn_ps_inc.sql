-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: igm_dbsn_ps_inc
-- Database: igm_dbsn, tabelle: ps_inc
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'wkb_geometry',
    'geometry', ST_AsGeoJSON(ST_Transform(d.wkb_geometry, 4326), 6)::json
  )::text
  FROM (
SELECT  ogc_fid,  wkb_geometry,
  CASE
    WHEN ps_inc_ty IN ('0102','0101') THEN 'arbusti'
    ELSE 'pascolo'
    END
    AS coduso FROM ps_inc
) AS d
  WHERE d.wkb_geometry && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
