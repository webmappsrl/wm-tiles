-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usosardegna
-- Database: general, tabelle: usosardegna2008
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM ( SELECT  gid,  geom,
   CASE
     WHEN udscod IN ('123','124','131','133','1221','1222') THEN 'bianco'
     WHEN udscod IN ('131','332','3311','3312','3313','3315') THEN 'bianco_sporco'
     WHEN udscod IN ('221') THEN 'vigneti'
     WHEN udscod IN ('222') THEN 'frutteti'
     WHEN udscod IN ('223') THEN 'frutteti'
     WHEN udscod IN ('231','333','2112') THEN 'pascolo'
     WHEN udscod IN ('242','243','2111','2121','2123','2122','2124','2411','2412','2413') THEN 'verdeneutro'
     WHEN udscod IN ('1421') THEN 'verdeurb'
     WHEN udscod IN ('3221','3222','3241','3242') THEN 'arbusti'
     WHEN udscod IN ('3111','31121','31122','31123') THEN 'blatifoglie'
     WHEN udscod IN ('3121','3122','3231','3232') THEN 'bconifere'
     WHEN udscod IN ('313','244') THEN 'bosco'
     WHEN udscod IN ('5111','5112','5121','5122','5211','5212','5213','5231','5232') THEN 'acque'
     WHEN udscod IN ('411','421','422','423') THEN 'zumide'
     ELSE 'fondogiallo'
     END
     AS coduso FROM usosardegna2008
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
