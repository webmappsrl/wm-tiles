-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: contourlines_hr, cl_hr_subd_labels
-- Database: general, tabelle: cl_hr_subd
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (SELECT geom, gid, quota, type
   FROM cl_hr_subd
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
