-- Generato da pipeline/tgen-layer-sql.py dal project.mml di TGen: non modificare a mano.
-- Layer: usofriuli
-- Database: general, tabelle: uso_friuli
COPY (
  SELECT json_build_object(
    'type', 'Feature',
    'properties', to_jsonb(d) - 'geom',
    'geometry', ST_AsGeoJSON(ST_Transform(d.geom, 4326), 6)::json
  )::text
  FROM ( SELECT  id,  geom,
    CASE
      WHEN ur_cd IN ('1221','1222','1223','1226','1227','1230','1241','1242','1310','1320','3310','3330') THEN 'bianco'
      WHEN ur_cd IN ('3320') THEN 'bianco_sporco'
      WHEN ur_cd IN ('2210') THEN 'vigneti'
      WHEN ur_cd IN ('2220') THEN 'frutteti'
      WHEN ur_cd IN ('2310','3210') THEN 'pascolo'
      WHEN ur_cd IN ('1410', '1420') THEN 'verdeurb'
      WHEN ur_cd IN ('3220','3240') THEN 'arbusti'
      WHEN ur_cd IN ('3110') THEN 'blatifoglie'
      WHEN ur_cd IN ('3120') THEN 'bconifere'
      WHEN ur_cd IN ('3130') THEN 'bosco'
      WHEN ur_cd IN ('5111','5112','5121','5122','5210','5230') THEN 'acque'
      WHEN ur_cd IN ('2421','2422','2430') THEN 'verdeneutro'
      WHEN ur_cd IN ('4110','4210','4220') THEN 'zumide'
      ELSE 'fondogiallo'
      END
      AS coduso FROM uso_friuli
) AS d
  WHERE d.geom && ST_Transform(ST_MakeEnvelope(6.6, 35.4, 18.6, 47.1, 4326), 3857)
) TO STDOUT WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01');
