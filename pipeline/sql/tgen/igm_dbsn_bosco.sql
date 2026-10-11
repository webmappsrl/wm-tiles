-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: igm_dbsn_bosco
-- Database: igm_dbsn, tabelle: bosco
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'wkb_geometry',
    'geometry', ST_AsGeoJSON(ST_Transform(d.wkb_geometry, 4326), 6)::json
  )::text
  FROM (
SELECT  ogc_fid,  wkb_geometry,
  CASE
    WHEN bosco_ty IN ('01') THEN 'bconifere'
    WHEN bosco_ty IN ('02','0202','0201') THEN 'blatifoglie'
    WHEN bosco_ty IN ('04') THEN 'arbusti'
    ELSE 'bosco'
    END
    AS coduso FROM bosco
) AS d
  WHERE d.wkb_geometry && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
