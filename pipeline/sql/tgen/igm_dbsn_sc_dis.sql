-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: igm_dbsn_sc_dis
-- Database: igm_dbsn, tabelle: sc_dis
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'wkb_geometry',
    'geometry', ST_AsGeoJSON(ST_Transform(d.wkb_geometry, 4326), 6)::json
  )::text
  FROM (
SELECT  ogc_fid,  wkb_geometry,
  CASE
    WHEN sc_dis_ty IN ('01') THEN 'bianco'
    ELSE 'bianco'
    END
    AS coduso FROM sc_dis
) AS d
  WHERE d.wkb_geometry && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
