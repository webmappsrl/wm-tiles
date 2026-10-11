-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usopiemonte
-- Database: general, tabelle: usopiemonte
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM (
  SELECT gid, geom,
      CASE
      WHEN cod_clc IN ('1','21','211','212') THEN 'fondogiallo'
      WHEN cod_clc IN ('33') THEN 'bianco'
      WHEN cod_clc IN ('213','331','411','412') THEN 'zumide'
      WHEN cod_clc IN ('221') THEN 'vigneti'
      WHEN cod_clc IN ('222') THEN 'frutteti'
      WHEN cod_clc IN ('231','321','333') THEN 'pascolo'
      WHEN cod_clc IN ('322') THEN 'arbusti'
      WHEN cod_clc IN ('311') THEN 'blatifoglie'
      WHEN cod_clc IN ('312') THEN 'bconifere'
      WHEN cod_clc IN ('3','31','313','324','334') THEN 'bosco'
      WHEN cod_clc IN ('51') THEN 'acque'
      WHEN cod_clc IN ('22') THEN 'verdeneutro'
      ELSE 'fondogiallo'
      END AS coduso
      FROM usopiemonte
  ) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
