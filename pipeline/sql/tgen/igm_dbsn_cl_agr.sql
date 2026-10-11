-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: igm_dbsn_cl_agr
-- Database: igm_dbsn, tabelle: cl_agr
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'wkb_geometry',
    'geometry', ST_AsGeoJSON(ST_Transform(d.wkb_geometry, 4326), 6)::json
  )::text
  FROM (
SELECT  ogc_fid,  wkb_geometry,
  CASE
    WHEN cl_agr_ty IN ('01','03') THEN 'vigneti'
    WHEN cl_agr_ty IN ('02') THEN 'frutteti'
    WHEN cl_agr_ty IN ('04') THEN 'oliveti'
    WHEN cl_agr_ty IN ('06') THEN 'zumide'
    WHEN cl_agr_ty IN ('09') THEN 'bosco'
    ELSE 'verdeneutro'
    END
    AS coduso FROM cl_agr
) AS d
  WHERE d.wkb_geometry && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
